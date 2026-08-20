package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// statskey-inputd is the Fleet remote-session input injection helper. The
// StatsKey desktop spawns it on the controlled Windows machine; it listens on
// the named pipe \\.\pipe\statskey-input (default DACL: the current console
// user and SYSTEM only) and executes validated mouse/keyboard primitives via
// SendInput. It never elevates, never shells out, and rejects everything
// that is not a bounded mouse or keyboard command.
//
// Wire protocol: one JSON command per LF-terminated line, at most
// MaxCommandBytes per line. Every command gets one JSON ack line,
// {"ok":true} or {"ok":false,"error":"<code>"}. A line that exceeds the
// bound is a protocol violation: the connection is closed without an ack.

const (
	// MaxCommandBytes bounds one command line including the newline.
	MaxCommandBytes = 4096
	// MaxCoordinate bounds pointer positions in host screen pixels.
	MaxCoordinate = 32767
	// MaxWheelDelta bounds wheel deltas (WHEEL_DELTA is 120 per notch).
	MaxWheelDelta = 4096
)

// Command types accepted over the pipe. Anything else fails closed.
const (
	CmdMouseMove = "mousemove"
	CmdMouseDown = "mousedown"
	CmdMouseUp   = "mouseup"
	CmdWheel     = "wheel"
	CmdKeyDown   = "keydown"
	CmdKeyUp     = "keyup"
)

var (
	ErrLineTooLong   = errors.New("inputd: command line exceeds 4 KiB")
	ErrUnknownType   = errors.New("inputd: unknown command type")
	ErrUnknownField  = errors.New("inputd: command carries an unexpected field")
	ErrBadCoordinate = errors.New("inputd: coordinate out of range")
	ErrBadButton     = errors.New("inputd: unknown mouse button")
	ErrBadDelta      = errors.New("inputd: wheel delta out of range")
	ErrBadKey        = errors.New("inputd: unknown key")
	ErrMissingField  = errors.New("inputd: command is missing a required field")
)

// Mouse buttons accepted by the helper.
var mouseButtons = map[string]bool{"left": true, "middle": true, "right": true}

// keyVirtualCodes maps DOM KeyboardEvent.code names (what the viewer sends)
// to Windows virtual-key codes. The allowlist is the security boundary: the
// desktop runtime cannot request an arbitrary virtual-key code.
var keyVirtualCodes = buildKeyMap()

func buildKeyMap() map[string]uint16 {
	m := map[string]uint16{
		"Backspace": 0x08, "Tab": 0x09, "Enter": 0x0D,
		"ShiftLeft": 0xA0, "ShiftRight": 0xA1,
		"ControlLeft": 0xA2, "ControlRight": 0xA3,
		"AltLeft": 0xA4, "AltRight": 0xA5,
		"CapsLock": 0x14, "Escape": 0x1B, "Space": 0x20,
		"PageUp": 0x21, "PageDown": 0x22, "End": 0x23, "Home": 0x24,
		"ArrowLeft": 0x25, "ArrowUp": 0x26, "ArrowRight": 0x27, "ArrowDown": 0x28,
		"Insert": 0x2D, "Delete": 0x2E,
		"MetaLeft": 0x5B, "MetaRight": 0x5C,
		"Semicolon": 0xBA, "Equal": 0xBB, "Comma": 0xBC, "Minus": 0xBD,
		"Period": 0xBE, "Slash": 0xBF, "Backquote": 0xC0,
		"BracketLeft": 0xDB, "Backslash": 0xDC, "BracketRight": 0xDD, "Quote": 0xDE,
	}
	for i := 0; i < 26; i++ {
		m[fmt.Sprintf("Key%c", 'A'+i)] = uint16(0x41 + i)
	}
	for i := 0; i < 10; i++ {
		m[fmt.Sprintf("Digit%d", i)] = uint16(0x30 + i)
	}
	for i := 1; i <= 12; i++ {
		m[fmt.Sprintf("F%d", i)] = uint16(0x70 + i - 1)
	}
	return m
}

// Command is one validated input primitive.
type Command struct {
	Type   string
	X, Y   int
	Button string
	DeltaX int
	DeltaY int
	Key    string
}

// commandWire is the strict JSON shape; pointer fields distinguish "absent"
// from zero so per-type field rules are exact.
type commandWire struct {
	Type   string  `json:"type"`
	X      *int64  `json:"x"`
	Y      *int64  `json:"y"`
	Button *string `json:"button"`
	DeltaX *int64  `json:"deltaX"`
	DeltaY *int64  `json:"deltaY"`
	Key    *string `json:"key"`
}

// ParseCommand decodes and validates one command line (newline optional).
func ParseCommand(line []byte) (Command, error) {
	var cmd Command
	line = bytes.TrimSuffix(line, []byte{'\n'})
	if len(line) == 0 {
		return cmd, ErrUnknownType
	}
	if len(line) > MaxCommandBytes {
		return cmd, ErrLineTooLong
	}
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.DisallowUnknownFields()
	var wire commandWire
	if err := dec.Decode(&wire); err != nil {
		return cmd, fmt.Errorf("inputd: invalid command JSON: %w", err)
	}
	coords := func() (int, int, error) {
		if wire.X == nil || wire.Y == nil {
			return 0, 0, ErrMissingField
		}
		x, y := *wire.X, *wire.Y
		if x < 0 || x > MaxCoordinate || y < 0 || y > MaxCoordinate {
			return 0, 0, ErrBadCoordinate
		}
		return int(x), int(y), nil
	}
	switch wire.Type {
	case CmdMouseMove, CmdMouseDown, CmdMouseUp:
		x, y, err := coords()
		if err != nil {
			return cmd, err
		}
		if wire.DeltaX != nil || wire.DeltaY != nil || wire.Key != nil {
			return cmd, ErrUnknownField
		}
		cmd = Command{Type: wire.Type, X: x, Y: y}
		if wire.Type == CmdMouseDown || wire.Type == CmdMouseUp {
			if wire.Button == nil {
				return cmd, ErrMissingField
			}
			if !mouseButtons[*wire.Button] {
				return cmd, ErrBadButton
			}
			cmd.Button = *wire.Button
		} else if wire.Button != nil {
			return cmd, ErrUnknownField
		}
	case CmdWheel:
		x, y, err := coords()
		if err != nil {
			return cmd, err
		}
		if wire.Button != nil || wire.Key != nil {
			return cmd, ErrUnknownField
		}
		if wire.DeltaY == nil && wire.DeltaX == nil {
			return cmd, ErrMissingField
		}
		cmd = Command{Type: wire.Type, X: x, Y: y}
		if wire.DeltaY != nil {
			if *wire.DeltaY < -MaxWheelDelta || *wire.DeltaY > MaxWheelDelta {
				return cmd, ErrBadDelta
			}
			cmd.DeltaY = int(*wire.DeltaY)
		}
		if wire.DeltaX != nil {
			if *wire.DeltaX < -MaxWheelDelta || *wire.DeltaX > MaxWheelDelta {
				return cmd, ErrBadDelta
			}
			cmd.DeltaX = int(*wire.DeltaX)
		}
		if cmd.DeltaX == 0 && cmd.DeltaY == 0 {
			return cmd, ErrBadDelta
		}
	case CmdKeyDown, CmdKeyUp:
		if wire.X != nil || wire.Y != nil || wire.Button != nil ||
			wire.DeltaX != nil || wire.DeltaY != nil {
			return cmd, ErrUnknownField
		}
		if wire.Key == nil {
			return cmd, ErrMissingField
		}
		if _, ok := keyVirtualCodes[*wire.Key]; !ok {
			return cmd, ErrBadKey
		}
		cmd = Command{Type: wire.Type, Key: *wire.Key}
	default:
		return cmd, ErrUnknownType
	}
	return cmd, nil
}

// Executor applies a validated command to the console session. The Windows
// implementation uses SendInput; tests substitute a recorder.
type Executor interface {
	Execute(cmd Command) error
}

// serveConn runs the line protocol until EOF or a protocol violation. The
// caller owns closing the connection.
func serveConn(r io.Reader, w io.Writer, exec Executor) error {
	br := bufio.NewReaderSize(r, MaxCommandBytes+2)
	for {
		line, err := readBoundedLine(br)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}
		cmd, perr := ParseCommand(line)
		if perr != nil {
			if err := writeAck(w, false, "invalid_command"); err != nil {
				return err
			}
			continue
		}
		if err := exec.Execute(cmd); err != nil {
			if err := writeAck(w, false, "execute_failed"); err != nil {
				return err
			}
			continue
		}
		if err := writeAck(w, true, ""); err != nil {
			return err
		}
	}
}

// readBoundedLine reads one LF-terminated line; a line longer than
// MaxCommandBytes (including the newline) is a protocol violation.
func readBoundedLine(br *bufio.Reader) ([]byte, error) {
	var line []byte
	for {
		frag, err := br.ReadSlice('\n')
		line = append(line, frag...)
		if len(line) > MaxCommandBytes {
			return nil, ErrLineTooLong
		}
		if err == bufio.ErrBufferFull {
			continue
		}
		if err != nil {
			if err == io.EOF && len(line) > 0 {
				return line, nil
			}
			return nil, err
		}
		return line, nil
	}
}

func writeAck(w io.Writer, ok bool, code string) error {
	var body []byte
	if ok {
		body = []byte(`{"ok":true}`)
	} else {
		encoded, err := json.Marshal(map[string]any{"ok": false, "error": code})
		if err != nil {
			return err
		}
		body = encoded
	}
	body = append(body, '\n')
	_, err := w.Write(body)
	return err
}
