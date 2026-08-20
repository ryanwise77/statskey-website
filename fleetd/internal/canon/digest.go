package canon

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// Digest returns base64url(SHA-256(canonical JSON of v)), matching
// digestCanonical in fleetAuth.js.
func Digest(v any) (string, error) {
	b, err := Encode(v)
	if err != nil {
		return "", err
	}
	return DigestBytes(b), nil
}

// DigestBytes returns base64url(SHA-256(b)).
func DigestBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

// FromJSON decodes ordinary (transport) JSON into encoder-compatible values,
// preserving integers exactly and rejecting non-integer numbers (the Fleet
// canonical form has integers only, so a fractional value can never be
// digested consistently — fail closed).
func FromJSON(data []byte) (any, error) {
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("canon: json decode: %w", err)
	}
	if dec.More() {
		return nil, fmt.Errorf("canon: trailing data")
	}
	return normalizeNumbers(v)
}

func normalizeNumbers(v any) (any, error) {
	switch t := v.(type) {
	case json.Number:
		n, err := t.Int64()
		if err != nil {
			return nil, fmt.Errorf("%w: %q", ErrFloat, t)
		}
		return n, nil
	case []any:
		for i := range t {
			n, err := normalizeNumbers(t[i])
			if err != nil {
				return nil, err
			}
			t[i] = n
		}
		return t, nil
	case map[string]any:
		for k := range t {
			n, err := normalizeNumbers(t[k])
			if err != nil {
				return nil, err
			}
			t[k] = n
		}
		return t, nil
	}
	return v, nil
}
