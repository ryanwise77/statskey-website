// Package fleetclient implements the Fleet device-request protocol against
// the coordinator, byte-compatible with desktop/fleet-node-client.cjs and
// workbench-backend/functions/fleetAuth.js:
//
//   - requests are signed envelopes (protocolVersion, deviceId, requestId,
//     action, issuedAt, expiresAt, payloadDigest) — Ed25519 over the
//     canonical JSON of the unsigned envelope
//   - the POST body is ordinary JSON: {action, payload, envelope}
//   - responses carry data.responseSignature, verified against the pinned
//     coordinator key over canonical JSON of
//     {domain:"statskey.fleet.response.v1", ...unsigned}
package fleetclient

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"statskey/fleetd/internal/canon"
	"statskey/fleetd/internal/keys"
	"statskey/fleetd/internal/wire"
)

const (
	// AuthVersion is FLEET_AUTH_VERSION.
	AuthVersion = 1
	// MaxLifetimeMs is MAX_ENVELOPE_LIFETIME_MS.
	MaxLifetimeMs = 5 * 60 * 1000
	// MaxClockSkewMs is MAX_CLOCK_SKEW_MS.
	MaxClockSkewMs = 30 * 1000
	// DefaultTimeoutMs matches DEFAULT_TIMEOUT_MS.
	DefaultTimeoutMs = 15_000
	// MaxResponseBytes matches MAX_RESPONSE_BYTES.
	MaxResponseBytes = 256 * 1024
)

// DeviceActions is the closed action set (protocol v2 adds helper.*).
var DeviceActions = []string{
	"device.status",
	"heartbeat",
	"job.poll",
	"job.claim",
	"lease.renew",
	"job.event",
	"job.transition",
	"artifact.reserve",
	"artifact.commit",
	"helper.bind",
	"helper.challenge",
	"helper.attest",
}

// RequestError mirrors FleetNodeClientError.
type RequestError struct {
	Code   string
	Status int
	Msg    string
}

func (e *RequestError) Error() string { return e.Msg }

func reqErr(code, msg string) *RequestError { return &RequestError{Code: code, Msg: msg} }

// NormalizeEndpoint validates the coordinator endpoint like
// normalizeFleetDeviceEndpoint: https only (loopback http allowed in tests),
// no credentials, query, fragment, or dot-dot segments.
func NormalizeEndpoint(raw string, allowLoopback bool) (string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u == nil {
		return "", reqErr("invalid_endpoint", "endpoint is not a URL")
	}
	loopback := u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(allowLoopback && loopback && u.Scheme == "http") {
		return "", reqErr("invalid_endpoint", "endpoint must be https")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Hostname() == "" {
		return "", reqErr("invalid_endpoint", "endpoint has disallowed components")
	}
	for _, seg := range strings.Split(u.Path, "/") {
		if seg == ".." {
			return "", reqErr("invalid_endpoint", "endpoint path has dot-dot")
		}
	}
	u.Path = strings.TrimRight(u.Path, "/")
	return u.String(), nil
}

// Client is a pinned-coordinator device transport.
type Client struct {
	Endpoint          string
	DeviceID          string
	PrivateKey        ed25519.PrivateKey
	CoordinatorKeyID  string
	CoordinatorPubKey ed25519.PublicKey
	HTTPClient        *http.Client
	// AllowLoopback permits http:// loopback endpoints (tests only).
	AllowLoopback bool
	// Now returns ms since epoch; nil → real clock.
	Now func() int64
}

// NewClient validates the configuration.
func NewClient(cfg Client) (*Client, error) {
	if _, err := NormalizeEndpoint(cfg.Endpoint, cfg.AllowLoopback); err != nil {
		return nil, err
	}
	if !wire.DeviceIDPattern.MatchString(cfg.DeviceID) {
		return nil, reqErr("invalid_device", "device id invalid")
	}
	if cfg.PrivateKey == nil {
		return nil, reqErr("invalid_device", "device private key required")
	}
	if !wire.ResponseKeyIDPattern.MatchString(cfg.CoordinatorKeyID) {
		return nil, reqErr("invalid_coordinator_trust", "coordinator key id invalid")
	}
	if cfg.CoordinatorPubKey == nil {
		return nil, reqErr("invalid_coordinator_trust", "coordinator public key required")
	}
	c := cfg
	if c.HTTPClient == nil {
		c.HTTPClient = &http.Client{Timeout: DefaultTimeoutMs * time.Millisecond}
	}
	return &c, nil
}

func (c *Client) now() int64 {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now().UnixMilli()
}

// CreateSignedRequest builds the signed request envelope (exported for
// testing against the JS fixtures).
func CreateSignedRequest(priv ed25519.PrivateKey, deviceID, action string, payload any, issuedAt, expiresAt int64, requestID string) (map[string]any, error) {
	if !wire.DeviceIDPattern.MatchString(deviceID) {
		return nil, reqErr("invalid_envelope", "device id invalid")
	}
	if !wire.RequestIDPattern.MatchString(requestID) {
		return nil, reqErr("invalid_envelope", "request id invalid")
	}
	if !wire.ActionPattern.MatchString(action) {
		return nil, reqErr("invalid_envelope", "action invalid")
	}
	if issuedAt < 0 || expiresAt <= issuedAt || expiresAt-issuedAt > MaxLifetimeMs {
		return nil, reqErr("invalid_envelope", "invalid request lifetime")
	}
	digest, err := canon.Digest(payload)
	if err != nil {
		return nil, err
	}
	unsigned := map[string]any{
		"protocolVersion": int64(AuthVersion),
		"deviceId":        deviceID,
		"requestId":       requestID,
		"action":          action,
		"issuedAt":        issuedAt,
		"expiresAt":       expiresAt,
		"payloadDigest":   digest,
	}
	raw, err := canon.Encode(unsigned)
	if err != nil {
		return nil, err
	}
	sig, err := keys.EncodeSignature(keys.Sign(priv, raw))
	if err != nil {
		return nil, err
	}
	unsigned["signature"] = sig
	return unsigned, nil
}

// NewRequestID returns req_<32 lowercase hex>.
func NewRequestID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return "req_" + hex.EncodeToString(b[:]), nil
}

// Do issues one signed device action and returns the verified result.
func (c *Client) Do(ctx context.Context, action string, payload any) (any, error) {
	if !containsStr(DeviceActions, action) {
		return nil, reqErr("invalid_action", "unsupported action")
	}
	requestID, err := NewRequestID()
	if err != nil {
		return nil, err
	}
	issuedAt := c.now()
	expiresAt := issuedAt + minInt64(60_000, DefaultTimeoutMs+15_000)
	envelope, err := CreateSignedRequest(c.PrivateKey, c.DeviceID, action, payload, issuedAt, expiresAt, requestID)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(map[string]any{
		"action":   action,
		"payload":  payload,
		"envelope": envelope,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.Endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, reqErr("invalid_endpoint", err.Error())
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, &RequestError{Code: "cancelled", Msg: "request cancelled"}
		}
		return nil, &RequestError{Code: "offline", Msg: "coordinator unreachable"}
	}
	defer resp.Body.Close()
	text, err := readBounded(resp, MaxResponseBytes)
	if err != nil {
		return nil, err
	}
	var bodyVal any
	if len(bytes.TrimSpace(text)) > 0 {
		bodyVal, err = canon.FromJSON(text)
		if err != nil {
			return nil, &RequestError{Code: "invalid_response", Status: resp.StatusCode, Msg: "invalid JSON response"}
		}
	}
	bodyMap, _ := bodyVal.(map[string]any)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || bodyMap == nil || bodyMap["data"] == nil {
		code := "fleet_request_failed"
		msg := fmt.Sprintf("request failed (%d)", resp.StatusCode)
		if em, ok := bodyMap["error"].(map[string]any); ok {
			if s, ok := em["code"].(string); ok && s != "" {
				code = truncateStr(s, 64)
			}
			if s, ok := em["message"].(string); ok && s != "" {
				msg = truncateStr(s, 300)
			}
		}
		return nil, &RequestError{Code: code, Status: resp.StatusCode, Msg: msg}
	}
	data, ok := bodyMap["data"].(map[string]any)
	if !ok {
		return nil, &RequestError{Code: "invalid_response", Status: resp.StatusCode, Msg: "response data invalid"}
	}
	result, hasResult := data["result"]
	respSig, _ := data["responseSignature"].(map[string]any)
	if data["action"] != action || data["deviceId"] != c.DeviceID || data["requestId"] != requestID || respSig == nil || !hasResult {
		return nil, &RequestError{Code: "invalid_response", Status: resp.StatusCode, Msg: "response not bound to this request"}
	}
	if err := VerifySignedResponse(c.CoordinatorPubKey, c.CoordinatorKeyID, respSig, c.DeviceID, requestID, action, result, c.now()); err != nil {
		return nil, &RequestError{Code: "invalid_response_signature", Status: resp.StatusCode, Msg: "coordinator response signature invalid"}
	}
	return result, nil
}

// VerifySignedResponse verifies a coordinator response envelope, mirroring
// verifySignedDeviceResponse in fleetAuth.js.
func VerifySignedResponse(pub ed25519.PublicKey, keyID string, envelope map[string]any, deviceID, requestID, action string, result any, nowMs int64) error {
	get := func(k string) (any, bool) { v, ok := envelope[k]; return v, ok }
	pv, _ := get("protocolVersion")
	kid, _ := get("keyId")
	did, _ := get("deviceId")
	rid, _ := get("requestId")
	act, _ := get("action")
	issued, _ := get("issuedAt")
	expires, _ := get("expiresAt")
	rd, _ := get("resultDigest")
	sigText, _ := get("signature")

	pvN, ok1 := pv.(int64)
	issuedN, ok2 := issued.(int64)
	expiresN, ok3 := expires.(int64)
	kidS, ok4 := kid.(string)
	didS, ok5 := did.(string)
	ridS, ok6 := rid.(string)
	actS, ok7 := act.(string)
	rdS, ok8 := rd.(string)
	if !ok1 || !ok2 || !ok3 || !ok4 || !ok5 || !ok6 || !ok7 || !ok8 {
		return errors.New("invalid_response_envelope")
	}
	if pvN != AuthVersion || !wire.ResponseKeyIDPattern.MatchString(kidS) ||
		!wire.DeviceIDPattern.MatchString(didS) || !wire.RequestIDPattern.MatchString(ridS) ||
		!wire.ActionPattern.MatchString(actS) ||
		expiresN <= issuedN || expiresN-issuedN > MaxLifetimeMs ||
		len(rdS) != 43 {
		return errors.New("invalid_response_envelope")
	}
	wantDigest, err := canon.Digest(result)
	if err != nil {
		return err
	}
	if kidS != keyID || didS != deviceID || ridS != requestID || actS != action ||
		issuedN > nowMs+MaxClockSkewMs || expiresN <= nowMs || rdS != wantDigest {
		return errors.New("response_mismatch")
	}
	sigS, ok := sigText.(string)
	if !ok {
		return errors.New("invalid_response_signature")
	}
	sig, err := keys.ParseSignature(sigS)
	if err != nil {
		return errors.New("invalid_response_signature")
	}
	unsigned := map[string]any{
		"domain":          "statskey.fleet.response.v1",
		"protocolVersion": pvN,
		"keyId":           kidS,
		"deviceId":        didS,
		"requestId":       ridS,
		"action":          actS,
		"issuedAt":        issuedN,
		"expiresAt":       expiresN,
		"resultDigest":    rdS,
	}
	raw, err := canon.Encode(unsigned)
	if err != nil {
		return err
	}
	if !keys.Verify(pub, raw, sig) {
		return errors.New("invalid_response_signature")
	}
	return nil
}

// VerifySignedRequest verifies a device request envelope (the coordinator
// side; implemented here for interop testing and reuse).
func VerifySignedRequest(pub ed25519.PublicKey, envelope map[string]any, payload any, expectedAction string, nowMs int64) error {
	pv, _ := envelope["protocolVersion"].(int64)
	did, _ := envelope["deviceId"].(string)
	rid, _ := envelope["requestId"].(string)
	act, _ := envelope["action"].(string)
	issued, _ := envelope["issuedAt"].(int64)
	expires, _ := envelope["expiresAt"].(int64)
	pdg, _ := envelope["payloadDigest"].(string)
	sigText, _ := envelope["signature"].(string)
	if pv != AuthVersion || !wire.DeviceIDPattern.MatchString(did) || !wire.RequestIDPattern.MatchString(rid) ||
		!wire.ActionPattern.MatchString(act) || len(pdg) != 43 {
		return errors.New("invalid_envelope")
	}
	if expires <= issued || expires-issued > MaxLifetimeMs {
		return errors.New("invalid_envelope")
	}
	if act != expectedAction {
		return errors.New("action_mismatch")
	}
	if issued > nowMs+MaxClockSkewMs || expires <= nowMs {
		return errors.New("expired_request")
	}
	wantDigest, err := canon.Digest(payload)
	if err != nil {
		return err
	}
	if pdg != wantDigest {
		return errors.New("payload_mismatch")
	}
	sig, err := keys.ParseSignature(sigText)
	if err != nil {
		return errors.New("invalid_signature")
	}
	unsigned := map[string]any{
		"protocolVersion": pv,
		"deviceId":        did,
		"requestId":       rid,
		"action":          act,
		"issuedAt":        issued,
		"expiresAt":       expires,
		"payloadDigest":   pdg,
	}
	raw, err := canon.Encode(unsigned)
	if err != nil {
		return err
	}
	if !keys.Verify(pub, raw, sig) {
		return errors.New("invalid_signature")
	}
	return nil
}

func readBounded(resp *http.Response, max int64) ([]byte, error) {
	if resp.ContentLength > max {
		return nil, &RequestError{Code: "invalid_response", Status: resp.StatusCode, Msg: "response too large"}
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > max {
		return nil, &RequestError{Code: "invalid_response", Status: resp.StatusCode, Msg: "response too large"}
	}
	return b, nil
}

func containsStr(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

func minInt64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

func truncateStr(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
