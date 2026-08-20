// Package canon implements the Fleet canonical JSON encoding used for every
// signed structure. It is byte-identical to the canonicalization in
// workbench-backend/functions/fleetAuth.js (canonicalJson/canonicalValue):
//
//   - UTF-8, no insignificant whitespace
//   - object keys sorted by UTF-16 code unit order (ECMAScript Array.sort)
//   - no duplicate keys
//   - integers only: no floats, no exponents (stricter than the JS encoder,
//     which the Fleet wire protocol narrows to integer-valued data)
//   - strings reject unpaired surrogates and U+2028/U+2029
//
// Limits mirror fleetAuth.js: at most 128 KiB of output, depth <= 12, and at
// most 512 items per array or object.
package canon

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"unicode/utf16"
	"unicode/utf8"
)

// integerLiteral matches a JSON integer literal (no decimal point, no
// exponent), the only json.Number form the JS canonical encoder produces.
var integerLiteral = regexp.MustCompile(`^-?(0|[1-9][0-9]*)$`)

const (
	// MaxBytes is MAX_CANONICAL_BYTES in fleetAuth.js.
	MaxBytes = 128 * 1024
	// MaxDepth is MAX_CANONICAL_DEPTH in fleetAuth.js. The depth check runs on
	// entry to each value with the root at depth 0, so values at depths 0..12
	// are accepted.
	MaxDepth = 12
	// MaxItems is MAX_CANONICAL_ITEMS in fleetAuth.js.
	MaxItems = 512
	// MaxSafeInteger is the largest magnitude JS can represent exactly. The
	// encoder rejects larger integers so output always round-trips through
	// the JS implementation byte-identically.
	MaxSafeInteger = int64(9007199254740991)
)

var (
	ErrTooLarge       = errors.New("canon: payload exceeds 128 KiB")
	ErrTooDeep        = errors.New("canon: payload exceeds depth 12")
	ErrTooManyItems   = errors.New("canon: array or object exceeds 512 items")
	ErrFloat          = errors.New("canon: floats and exponents are not allowed")
	ErrUnsafeInteger  = errors.New("canon: integer outside JS safe-integer range")
	ErrInvalidString  = errors.New("canon: string is not valid UTF-8")
	ErrLineSeparator  = errors.New("canon: string contains U+2028/U+2029")
	ErrUnsupportedVal = errors.New("canon: unsupported value type")
)

// Encode returns the canonical JSON encoding of v. Supported Go types:
// nil, bool, string, all int/uint kinds (safe-integer range only),
// json.Number (integer form only), []any, and map[string]any.
func Encode(v any) ([]byte, error) {
	var buf bytes.Buffer
	if err := encodeValue(&buf, v, 0); err != nil {
		return nil, err
	}
	if buf.Len() > MaxBytes {
		return nil, ErrTooLarge
	}
	return buf.Bytes(), nil
}

func encodeValue(buf *bytes.Buffer, v any, depth int) error {
	if depth > MaxDepth {
		return ErrTooDeep
	}
	switch t := v.(type) {
	case nil:
		buf.WriteString("null")
	case bool:
		if t {
			buf.WriteString("true")
		} else {
			buf.WriteString("false")
		}
	case string:
		return appendJSONString(buf, t)
	case int:
		return appendInt(buf, int64(t))
	case int8:
		return appendInt(buf, int64(t))
	case int16:
		return appendInt(buf, int64(t))
	case int32:
		return appendInt(buf, int64(t))
	case int64:
		return appendInt(buf, t)
	case uint:
		return appendUint(buf, uint64(t))
	case uint8:
		return appendUint(buf, uint64(t))
	case uint16:
		return appendUint(buf, uint64(t))
	case uint32:
		return appendUint(buf, uint64(t))
	case uint64:
		return appendUint(buf, t)
	case float32, float64:
		return ErrFloat
	case json.Number:
		// Integer literal form only; anything else (decimals, exponents)
		// cannot round-trip through the JS canonical encoder.
		s := t.String()
		if !integerLiteral.MatchString(s) {
			return ErrFloat
		}
		buf.WriteString(s)
	case []any:
		if len(t) > MaxItems {
			return ErrTooManyItems
		}
		buf.WriteByte('[')
		for i, item := range t {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := encodeValue(buf, item, depth+1); err != nil {
				return err
			}
		}
		buf.WriteByte(']')
	case map[string]any:
		if len(t) > MaxItems {
			return ErrTooManyItems
		}
		keys := make([]string, 0, len(t))
		for k := range t {
			keys = append(keys, k)
		}
		SortKeys(keys)
		buf.WriteByte('{')
		for i, k := range keys {
			if i > 0 {
				buf.WriteByte(',')
			}
			if err := appendJSONString(buf, k); err != nil {
				return err
			}
			buf.WriteByte(':')
			if err := encodeValue(buf, t[k], depth+1); err != nil {
				return err
			}
		}
		buf.WriteByte('}')
	default:
		return fmt.Errorf("%w: %T", ErrUnsupportedVal, v)
	}
	return nil
}

func appendInt(buf *bytes.Buffer, v int64) error {
	if v > MaxSafeInteger || v < -MaxSafeInteger {
		return ErrUnsafeInteger
	}
	var tmp [20]byte
	n := formatInt(tmp[:], v)
	buf.Write(tmp[:n])
	return nil
}

func appendUint(buf *bytes.Buffer, v uint64) error {
	if v > uint64(MaxSafeInteger) {
		return ErrUnsafeInteger
	}
	var tmp [20]byte
	n := formatUint(tmp[:], v)
	buf.Write(tmp[:n])
	return nil
}

func formatInt(b []byte, v int64) int {
	if v < 0 {
		b[0] = '-'
		return 1 + formatUint(b[1:], uint64(-v))
	}
	return formatUint(b, uint64(v))
}

func formatUint(b []byte, v uint64) int {
	if v == 0 {
		b[0] = '0'
		return 1
	}
	n := 0
	for v > 0 {
		b[n] = byte('0' + v%10)
		v /= 10
		n++
	}
	for i, j := 0, n-1; i < j; i, j = i+1, j-1 {
		b[i], b[j] = b[j], b[i]
	}
	return n
}

// appendJSONString writes s using the exact escaping rules of ECMAScript
// JSON.stringify: only '"', '\\', and C0 controls are escaped (with the short
// forms \b \t \n \f \r and lowercase \u00xx otherwise); every other code point
// is emitted as raw UTF-8. Strings containing invalid UTF-8 or U+2028/U+2029
// are rejected per the Fleet wire spec.
func appendJSONString(buf *bytes.Buffer, s string) error {
	buf.WriteByte('"')
	for i := 0; i < len(s); {
		c := s[i]
		switch {
		case c == '"':
			buf.WriteString(`\"`)
			i++
		case c == '\\':
			buf.WriteString(`\\`)
			i++
		case c == '\b':
			buf.WriteString(`\b`)
			i++
		case c == '\t':
			buf.WriteString(`\t`)
			i++
		case c == '\n':
			buf.WriteString(`\n`)
			i++
		case c == '\f':
			buf.WriteString(`\f`)
			i++
		case c == '\r':
			buf.WriteString(`\r`)
			i++
		case c < 0x20:
			fmt.Fprintf(buf, `\u%04x`, c)
			i++
		case c < 0x80:
			buf.WriteByte(c)
			i++
		default:
			r, size := utf8.DecodeRuneInString(s[i:])
			if r == utf8.RuneError && size <= 1 {
				return ErrInvalidString
			}
			if r == 0x2028 || r == 0x2029 {
				return ErrLineSeparator
			}
			buf.WriteString(s[i : i+size])
			i += size
		}
	}
	buf.WriteByte('"')
	return nil
}

// SortKeys sorts object keys in ECMAScript Array.prototype.sort order, i.e.
// by UTF-16 code units. This differs from UTF-8 byte order when non-BMP code
// points (which encode as surrogate pairs below U+E000) meet BMP code points
// at or above U+E000.
func SortKeys(keys []string) {
	sort.Slice(keys, func(i, j int) bool {
		return CompareUTF16(keys[i], keys[j]) < 0
	})
}

// CompareUTF16 compares two valid UTF-8 strings by UTF-16 code unit order.
func CompareUTF16(a, b string) int {
	ua := utf16.Encode([]rune(a))
	ub := utf16.Encode([]rune(b))
	for i := 0; i < len(ua) && i < len(ub); i++ {
		if ua[i] != ub[i] {
			if ua[i] < ub[i] {
				return -1
			}
			return 1
		}
	}
	switch {
	case len(ua) < len(ub):
		return -1
	case len(ua) > len(ub):
		return 1
	}
	return 0
}
