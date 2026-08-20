package wire

import (
	"errors"
	"fmt"
	"regexp"
	"time"

	"statskey/fleetd/internal/canon"
)

// Strict typed decoding over canonical-JSON values. Every field is consumed
// explicitly; Done rejects anything left over (unknown fields fail closed).

var (
	ErrNotObject    = errors.New("wire: value is not an object")
	ErrUnknownField = errors.New("wire: unknown field")
	ErrBadField     = errors.New("wire: field failed validation")
)

// Obj is a strict object decoder tracking consumed keys.
type Obj struct {
	m    map[string]any
	seen map[string]bool
}

// NewObj wraps a decoded canonical value.
func NewObj(v any) (*Obj, error) {
	m, ok := v.(map[string]any)
	if !ok {
		return nil, ErrNotObject
	}
	return &Obj{m: m, seen: make(map[string]bool, len(m))}, nil
}

// ParseObj strictly validates canonical bytes and returns an Obj decoder.
func ParseObj(b []byte) (*Obj, error) {
	v, err := canon.Parse(b)
	if err != nil {
		return nil, err
	}
	return NewObj(v)
}

func (o *Obj) take(key string) (any, error) {
	v, ok := o.m[key]
	if !ok {
		return nil, fmt.Errorf("%w: missing %q", ErrBadField, key)
	}
	o.seen[key] = true
	return v, nil
}

// Raw reads a required field without interpreting it (marks it consumed).
func (o *Obj) Raw(key string) (any, error) {
	return o.take(key)
}

// OptionalStr reads an optional string field; "" when absent.
func (o *Obj) OptionalStr(key string, re *regexp.Regexp) (string, error) {
	v, ok := o.m[key]
	if !ok {
		return "", nil
	}
	o.seen[key] = true
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%w: %q must be a string", ErrBadField, key)
	}
	if re != nil && !re.MatchString(s) {
		return "", fmt.Errorf("%w: %q has invalid shape", ErrBadField, key)
	}
	return s, nil
}

// Done fails if any key was not consumed.
func (o *Obj) Done() error {
	for k := range o.m {
		if !o.seen[k] {
			return fmt.Errorf("%w: %q", ErrUnknownField, k)
		}
	}
	return nil
}

// Str reads a required string field matching re.
func (o *Obj) Str(key string, re *regexp.Regexp) (string, error) {
	v, err := o.take(key)
	if err != nil {
		return "", err
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%w: %q must be a string", ErrBadField, key)
	}
	if re != nil && !re.MatchString(s) {
		return "", fmt.Errorf("%w: %q has invalid shape", ErrBadField, key)
	}
	return s, nil
}

// StrLen reads a required string field with a length bound.
func (o *Obj) StrLen(key string, maxLen int) (string, error) {
	v, err := o.take(key)
	if err != nil {
		return "", err
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%w: %q must be a string", ErrBadField, key)
	}
	if len(s) > maxLen {
		return "", fmt.Errorf("%w: %q too long", ErrBadField, key)
	}
	return s, nil
}

// StrEnum reads a required string field restricted to a set.
func (o *Obj) StrEnum(key string, allowed ...string) (string, error) {
	v, err := o.take(key)
	if err != nil {
		return "", err
	}
	s, ok := v.(string)
	if !ok {
		return "", fmt.Errorf("%w: %q must be a string", ErrBadField, key)
	}
	for _, a := range allowed {
		if s == a {
			return s, nil
		}
	}
	return "", fmt.Errorf("%w: %q not in allowed set", ErrBadField, key)
}

// Int reads a required integer field within [min, max].
func (o *Obj) Int(key string, min, max int64) (int64, error) {
	v, err := o.take(key)
	if err != nil {
		return 0, err
	}
	n, ok := v.(int64)
	if !ok {
		return 0, fmt.Errorf("%w: %q must be an integer", ErrBadField, key)
	}
	if n < min || n > max {
		return 0, fmt.Errorf("%w: %q out of range [%d,%d]", ErrBadField, key, min, max)
	}
	return n, nil
}

// Bool reads a required boolean field.
func (o *Obj) Bool(key string) (bool, error) {
	v, err := o.take(key)
	if err != nil {
		return false, err
	}
	b, ok := v.(bool)
	if !ok {
		return false, fmt.Errorf("%w: %q must be a boolean", ErrBadField, key)
	}
	return b, nil
}

// Obj reads a required nested object field.
func (o *Obj) Obj(key string) (*Obj, error) {
	v, err := o.take(key)
	if err != nil {
		return nil, err
	}
	nested, ok := v.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("%w: %q must be an object", ErrBadField, key)
	}
	return &Obj{m: nested, seen: make(map[string]bool, len(nested))}, nil
}

// StrSlice reads a required string array with item count/length bounds.
func (o *Obj) StrSlice(key string, maxItems, maxLen int) ([]string, error) {
	v, err := o.take(key)
	if err != nil {
		return nil, err
	}
	arr, ok := v.([]any)
	if !ok {
		return nil, fmt.Errorf("%w: %q must be an array", ErrBadField, key)
	}
	if len(arr) > maxItems {
		return nil, fmt.Errorf("%w: %q has too many items", ErrBadField, key)
	}
	out := make([]string, 0, len(arr))
	for i, item := range arr {
		s, ok := item.(string)
		if !ok {
			return nil, fmt.Errorf("%w: %q[%d] must be a string", ErrBadField, key, i)
		}
		if len(s) > maxLen {
			return nil, fmt.Errorf("%w: %q[%d] too long", ErrBadField, key, i)
		}
		out = append(out, s)
	}
	return out, nil
}

// TimestampLayout is the RFC3339-milliseconds-UTC form used on the wire.
const TimestampLayout = "2006-01-02T15:04:05.000Z"

// Time reads a required RFC3339-ms-UTC timestamp field.
func (o *Obj) Time(key string) (time.Time, error) {
	s, err := o.Str(key, timestampPattern)
	if err != nil {
		return time.Time{}, err
	}
	t, err := ParseTimestamp(s)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: %q: %v", ErrBadField, key, err)
	}
	return t, nil
}

// ParseTimestamp parses and canonically re-checks an RFC3339-ms-UTC string.
func ParseTimestamp(s string) (time.Time, error) {
	if !timestampPattern.MatchString(s) {
		return time.Time{}, errors.New("wire: timestamp must be RFC3339 ms UTC")
	}
	t, err := time.Parse(TimestampLayout, s)
	if err != nil {
		return time.Time{}, err
	}
	if FormatTimestamp(t) != s {
		return time.Time{}, errors.New("wire: timestamp is not canonical")
	}
	return t, nil
}

// FormatTimestamp renders t in canonical RFC3339-ms-UTC form.
func FormatTimestamp(t time.Time) string {
	return t.UTC().Format(TimestampLayout)
}
