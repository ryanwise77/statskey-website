package wire

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"

	"statskey/fleetd/internal/canon"
)

// Local IPC between the unprivileged agent and the root daemon
// (FLEETD_DESIGN.md "Local IPC"): one request per connection, 4-byte
// big-endian length prefix, canonical JSON body, maximum 64 KiB.

const (
	// MaxFrameBytes is the hard frame bound for both directions.
	MaxFrameBytes = 64 * 1024

	MethodPublicKey = "publicKey"
	MethodAttest    = "attest"
	MethodStart     = "start"
	MethodRenew     = "renew"
	MethodStop      = "stop"
	MethodStatus    = "status"
	MethodSettle    = "settle"
)

// Methods is the closed set of IPC methods.
var Methods = []string{
	MethodPublicKey,
	MethodAttest,
	MethodStart,
	MethodRenew,
	MethodStop,
	MethodStatus,
	MethodSettle,
}

var (
	ErrFrameTooLarge = errors.New("wire: IPC frame exceeds 64 KiB")
	ErrFrameShort    = errors.New("wire: IPC frame too short")
	ErrBadMethod     = errors.New("wire: unknown IPC method")
)

// IPCRequest is the decoded request envelope. Params is validated per method
// by the daemon before any side effect.
type IPCRequest struct {
	Method string
	Params *Obj
}

// IPCResponse is the response envelope: exactly one of result or error.
type IPCResponse struct {
	OK      bool
	Result  map[string]any
	ErrCode string
	ErrMsg  string
}

// EncodeRequest canonicalizes a request envelope.
func EncodeRequest(method string, params map[string]any) ([]byte, error) {
	if params == nil {
		params = map[string]any{}
	}
	return canon.Encode(map[string]any{"method": method, "params": params})
}

// DecodeRequest strictly parses a request frame body.
func DecodeRequest(b []byte) (*IPCRequest, error) {
	o, err := ParseObj(b)
	if err != nil {
		return nil, err
	}
	method, err := o.StrEnum("method", Methods...)
	if err != nil {
		return nil, err
	}
	params, err := o.Obj("params")
	if err != nil {
		return nil, err
	}
	if err := o.Done(); err != nil {
		return nil, err
	}
	return &IPCRequest{Method: method, Params: params}, nil
}

// EncodeResponse canonicalizes a response envelope.
func EncodeResponse(resp IPCResponse) ([]byte, error) {
	if resp.OK {
		result := resp.Result
		if result == nil {
			result = map[string]any{}
		}
		return canon.Encode(map[string]any{"ok": true, "result": result})
	}
	return canon.Encode(map[string]any{
		"ok": false,
		"error": map[string]any{
			"code":    resp.ErrCode,
			"message": resp.ErrMsg,
		},
	})
}

// DecodeResponse strictly parses a response frame body.
func DecodeResponse(b []byte) (*IPCResponse, error) {
	o, err := ParseObj(b)
	if err != nil {
		return nil, err
	}
	ok, err := o.Bool("ok")
	if err != nil {
		return nil, err
	}
	resp := &IPCResponse{OK: ok}
	if ok {
		res, err := o.Obj("result")
		if err != nil {
			return nil, err
		}
		// Result content is method-specific; the consumer validates it.
		resp.Result = res.Map()
	} else {
		eo, err := o.Obj("error")
		if err != nil {
			return nil, err
		}
		if resp.ErrCode, err = eo.StrLen("code", 64); err != nil {
			return nil, err
		}
		if resp.ErrMsg, err = eo.StrLen("message", 300); err != nil {
			return nil, err
		}
		if err := eo.Done(); err != nil {
			return nil, err
		}
	}
	if err := o.Done(); err != nil {
		return nil, err
	}
	return resp, nil
}

// Map exposes the underlying consumed map of an Obj that has passed Done.
func (o *Obj) Map() map[string]any { return o.m }

// WriteFrame writes a length-prefixed frame.
func WriteFrame(w io.Writer, body []byte) error {
	if len(body) > MaxFrameBytes {
		return ErrFrameTooLarge
	}
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], uint32(len(body)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.Write(body)
	return err
}

// ReadFrame reads one length-prefixed frame with a hard size bound. The full
// frame is read before returning; partial frames are errors.
func ReadFrame(r io.Reader) ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > MaxFrameBytes {
		return nil, ErrFrameTooLarge
	}
	if n < 2 {
		return nil, ErrFrameShort
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return nil, fmt.Errorf("wire: short frame: %w", err)
	}
	return body, nil
}
