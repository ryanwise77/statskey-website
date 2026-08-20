package canon

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Strict parse/validation for canonical JSON. Every byte accepted here is a
// byte the encoder could have produced, so Parse followed by Encode is the
// identity. Anything else fails closed:
//
//   - no whitespace anywhere (canonical JSON has none)
//   - integers only: -?(0|[1-9][0-9]*), no "-0", must fit int64
//   - strings: valid UTF-8, no raw C0 controls, escapes limited to the exact
//     set JSON.stringify emits (\" \\ \b \t \n \f \r and lowercase \u00xx for
//     other C0 controls), no surrogate escapes, no U+2028/U+2029
//   - object keys in strict increasing UTF-16 order (implies no duplicates)
//   - depth <= 12, <= 512 items per container, input <= 128 KiB

var (
	ErrSyntax        = errors.New("canon: invalid canonical JSON syntax")
	ErrDuplicateKeys = errors.New("canon: object keys out of order or duplicated")
	ErrTrailing      = errors.New("canon: trailing data after value")
)

// Validate reports whether b is well-formed canonical JSON.
func Validate(b []byte) error {
	_, err := Parse(b)
	return err
}

// Parse strictly validates b as canonical JSON and returns the decoded value
// (nil, bool, string, int64, []any, or map[string]any).
func Parse(b []byte) (any, error) {
	if len(b) > MaxBytes {
		return nil, ErrTooLarge
	}
	if len(b) == 0 {
		return nil, ErrSyntax
	}
	p := &parser{buf: b}
	v, err := p.value(0)
	if err != nil {
		return nil, err
	}
	if p.pos != len(b) {
		return nil, ErrTrailing
	}
	return v, nil
}

type parser struct {
	buf []byte
	pos int
}

func (p *parser) value(depth int) (any, error) {
	if depth > MaxDepth {
		return nil, ErrTooDeep
	}
	if p.pos >= len(p.buf) {
		return nil, ErrSyntax
	}
	switch c := p.buf[p.pos]; {
	case c == 'n':
		if err := p.literal("null"); err != nil {
			return nil, err
		}
		return nil, nil
	case c == 't':
		if err := p.literal("true"); err != nil {
			return nil, err
		}
		return true, nil
	case c == 'f':
		if err := p.literal("false"); err != nil {
			return nil, err
		}
		return false, nil
	case c == '"':
		return p.string()
	case c == '[':
		return p.array(depth)
	case c == '{':
		return p.object(depth)
	case c == '-' || (c >= '0' && c <= '9'):
		return p.number()
	}
	return nil, ErrSyntax
}

func (p *parser) literal(s string) error {
	if len(p.buf)-p.pos < len(s) || string(p.buf[p.pos:p.pos+len(s)]) != s {
		return ErrSyntax
	}
	p.pos += len(s)
	return nil
}

func (p *parser) number() (any, error) {
	start := p.pos
	neg := false
	if p.buf[p.pos] == '-' {
		neg = true
		p.pos++
		if p.pos >= len(p.buf) {
			return nil, ErrSyntax
		}
	}
	if p.buf[p.pos] == '0' {
		p.pos++
		if neg {
			// JSON.stringify(-0) is "0"; "-0" is never canonical.
			return nil, ErrSyntax
		}
	} else if p.buf[p.pos] >= '1' && p.buf[p.pos] <= '9' {
		for p.pos < len(p.buf) && p.buf[p.pos] >= '0' && p.buf[p.pos] <= '9' {
			p.pos++
		}
	} else {
		return nil, ErrSyntax
	}
	// Any '.', 'e', or 'E' here means a float/exponent: not canonical.
	if p.pos < len(p.buf) {
		switch p.buf[p.pos] {
		case '.', 'e', 'E', '+':
			return nil, ErrFloat
		}
	}
	text := string(p.buf[start:p.pos])
	v, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("%w: %q", ErrUnsafeInteger, text)
	}
	return v, nil
}

func (p *parser) string() (string, error) {
	p.pos++ // consume opening quote
	var sb strings.Builder
	for {
		if p.pos >= len(p.buf) {
			return "", ErrSyntax
		}
		c := p.buf[p.pos]
		switch {
		case c == '"':
			p.pos++
			return sb.String(), nil
		case c == '\\':
			p.pos++
			if p.pos >= len(p.buf) {
				return "", ErrSyntax
			}
			esc := p.buf[p.pos]
			p.pos++
			switch esc {
			case '"':
				sb.WriteByte('"')
			case '\\':
				sb.WriteByte('\\')
			case 'b':
				sb.WriteByte('\b')
			case 't':
				sb.WriteByte('\t')
			case 'n':
				sb.WriteByte('\n')
			case 'f':
				sb.WriteByte('\f')
			case 'r':
				sb.WriteByte('\r')
			case 'u':
				if len(p.buf)-p.pos < 4 {
					return "", ErrSyntax
				}
				hex := p.buf[p.pos : p.pos+4]
				cp := 0
				for _, h := range hex {
					cp <<= 4
					switch {
					case h >= '0' && h <= '9':
						cp |= int(h - '0')
					case h >= 'a' && h <= 'f':
						cp |= int(h-'a') + 10
					default:
						// Uppercase hex and non-hex are never canonical.
						return "", ErrSyntax
					}
				}
				p.pos += 4
				// Canonical \u00xx escapes exist only for C0 controls without
				// a short escape. Surrogate escapes are rejected outright
				// (unpaired surrogates are forbidden; paired ones are never
				// emitted by JSON.stringify).
				if cp >= 0x20 || cp == 0x08 || cp == 0x09 || cp == 0x0a || cp == 0x0c || cp == 0x0d {
					return "", ErrSyntax
				}
				sb.WriteByte(byte(cp))
			default:
				// Includes \/, which JSON.stringify never emits.
				return "", ErrSyntax
			}
		case c < 0x20:
			// Raw control characters must be escaped in canonical form.
			return "", ErrSyntax
		case c < 0x80:
			sb.WriteByte(c)
			p.pos++
		default:
			r, size := utf8.DecodeRune(p.buf[p.pos:])
			if r == utf8.RuneError && size <= 1 {
				return "", ErrInvalidString
			}
			if r == 0x2028 || r == 0x2029 {
				return "", ErrLineSeparator
			}
			sb.Write(p.buf[p.pos : p.pos+size])
			p.pos += size
		}
	}
}

func (p *parser) array(depth int) (any, error) {
	p.pos++ // consume '['
	if p.pos < len(p.buf) && p.buf[p.pos] == ']' {
		p.pos++
		return []any{}, nil
	}
	items := make([]any, 0, 8)
	for {
		v, err := p.value(depth + 1)
		if err != nil {
			return nil, err
		}
		items = append(items, v)
		if len(items) > MaxItems {
			return nil, ErrTooManyItems
		}
		if p.pos >= len(p.buf) {
			return nil, ErrSyntax
		}
		switch p.buf[p.pos] {
		case ',':
			p.pos++
		case ']':
			p.pos++
			return items, nil
		default:
			return nil, ErrSyntax
		}
	}
}

func (p *parser) object(depth int) (any, error) {
	p.pos++ // consume '{'
	obj := make(map[string]any, 8)
	if p.pos < len(p.buf) && p.buf[p.pos] == '}' {
		p.pos++
		return obj, nil
	}
	prev := ""
	first := true
	for {
		if p.pos >= len(p.buf) || p.buf[p.pos] != '"' {
			return nil, ErrSyntax
		}
		key, err := p.string()
		if err != nil {
			return nil, err
		}
		if !first && CompareUTF16(prev, key) >= 0 {
			return nil, ErrDuplicateKeys
		}
		first = false
		prev = key
		if p.pos >= len(p.buf) || p.buf[p.pos] != ':' {
			return nil, ErrSyntax
		}
		p.pos++
		v, err := p.value(depth + 1)
		if err != nil {
			return nil, err
		}
		obj[key] = v
		if len(obj) > MaxItems {
			return nil, ErrTooManyItems
		}
		if p.pos >= len(p.buf) {
			return nil, ErrSyntax
		}
		switch p.buf[p.pos] {
		case ',':
			p.pos++
		case '}':
			p.pos++
			return obj, nil
		default:
			return nil, ErrSyntax
		}
	}
}
