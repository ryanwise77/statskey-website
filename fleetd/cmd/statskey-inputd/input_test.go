package main

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestParseMouseMove(t *testing.T) {
	cmd, err := ParseCommand([]byte(`{"type":"mousemove","x":100,"y":200}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cmd.Type != CmdMouseMove || cmd.X != 100 || cmd.Y != 200 {
		t.Fatalf("cmd = %+v", cmd)
	}
}

func TestParseMouseButton(t *testing.T) {
	cmd, err := ParseCommand([]byte(`{"type":"mousedown","x":1,"y":2,"button":"left"}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cmd.Type != CmdMouseDown || cmd.Button != "left" {
		t.Fatalf("cmd = %+v", cmd)
	}
}

func TestParseWheel(t *testing.T) {
	cmd, err := ParseCommand([]byte(`{"type":"wheel","x":0,"y":0,"deltaY":-240}`))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cmd.Type != CmdWheel || cmd.DeltaY != -240 || cmd.DeltaX != 0 {
		t.Fatalf("cmd = %+v", cmd)
	}
}

func TestParseKey(t *testing.T) {
	for _, name := range []string{"KeyA", "Digit9", "Enter", "ShiftLeft", "F12", "ArrowDown"} {
		if _, err := ParseCommand([]byte(`{"type":"keydown","key":"` + name + `"}`)); err != nil {
			t.Fatalf("parse key %s: %v", name, err)
		}
	}
}

func TestParseRejects(t *testing.T) {
	cases := map[string]error{
		// Unknown or missing type.
		`{"type":"screenshot"}`: ErrUnknownType,
		`{"x":1,"y":2}`:         ErrUnknownType,
		`{}`:                    ErrUnknownType,
		`not json`:              nil,
		// Coordinates out of range or missing.
		`{"type":"mousemove","x":-1,"y":0}`:    ErrBadCoordinate,
		`{"type":"mousemove","x":0,"y":32768}`: ErrBadCoordinate,
		`{"type":"mousemove","x":0}`:           ErrMissingField,
		// Floats are not integers and must not decode.
		`{"type":"mousemove","x":1.5,"y":2}`: nil,
		// Unknown fields fail closed.
		`{"type":"mousemove","x":1,"y":2,"z":3}`: nil,
		`{"type":"keydown","key":"KeyA","x":1}`:  ErrUnknownField,
		// Button rules.
		`{"type":"mousedown","x":1,"y":2,"button":"primary"}`: ErrBadButton,
		`{"type":"mousedown","x":1,"y":2}`:                    ErrMissingField,
		`{"type":"mousemove","x":1,"y":2,"button":"left"}`:    ErrUnknownField,
		// Wheel rules.
		`{"type":"wheel","x":0,"y":0}`:                ErrMissingField,
		`{"type":"wheel","x":0,"y":0,"deltaY":0}`:     ErrBadDelta,
		`{"type":"wheel","x":0,"y":0,"deltaY":4097}`:  ErrBadDelta,
		`{"type":"wheel","x":0,"y":0,"deltaX":-4097}`: ErrBadDelta,
		// Key rules.
		`{"type":"keydown"}`:                  ErrMissingField,
		`{"type":"keydown","key":"Sleep"}`:    ErrBadKey,
		`{"type":"keydown","key":""}`:         ErrBadKey,
		`{"type":"keyup","key":"KeyA","y":3}`: ErrUnknownField,
	}
	for input, want := range cases {
		_, err := ParseCommand([]byte(input))
		if err == nil {
			t.Fatalf("%s: expected rejection", input)
		}
		if want != nil && !errors.Is(err, want) {
			t.Fatalf("%s: error = %v, want %v", input, err, want)
		}
	}
}

func TestKeyMapCoversExpectedKeys(t *testing.T) {
	expected := []string{
		"Backspace", "Tab", "Enter", "Escape", "Space", "CapsLock",
		"ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight",
		"AltLeft", "AltRight", "MetaLeft", "MetaRight",
		"Home", "End", "PageUp", "PageDown", "Insert", "Delete",
		"ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
		"Semicolon", "Equal", "Comma", "Minus", "Period", "Slash",
		"Backquote", "BracketLeft", "Backslash", "BracketRight", "Quote",
	}
	for _, k := range expected {
		if _, ok := keyVirtualCodes[k]; !ok {
			t.Fatalf("key %s missing from allowlist", k)
		}
	}
	for i := 0; i < 26; i++ {
		name := "Key" + string(rune('A'+i))
		if vk, ok := keyVirtualCodes[name]; !ok || vk != uint16(0x41+i) {
			t.Fatalf("%s vk = %x, ok = %v", name, vk, ok)
		}
	}
	for i := 1; i <= 12; i++ {
		name := fmt.Sprintf("F%d", i)
		if _, ok := keyVirtualCodes[name]; !ok {
			t.Fatalf("%s missing", name)
		}
	}
}

type recordingExecutor struct {
	commands []Command
	fail     bool
}

func (r *recordingExecutor) Execute(cmd Command) error {
	if r.fail {
		return errors.New("recorder failure")
	}
	r.commands = append(r.commands, cmd)
	return nil
}

func TestServeConnRoundTrip(t *testing.T) {
	input := strings.Join([]string{
		`{"type":"mousemove","x":10,"y":20}`,
		`{"type":"mousedown","x":10,"y":20,"button":"left"}`,
		`{"type":"mouseup","x":10,"y":20,"button":"left"}`,
		`{"type":"keydown","key":"KeyA"}`,
		`{"type":"keyup","key":"KeyA"}`,
		`{"type":"wheel","x":10,"y":20,"deltaY":120}`,
	}, "\n") + "\n"
	var out bytes.Buffer
	exec := &recordingExecutor{}
	if err := serveConn(strings.NewReader(input), &out, exec); err != nil {
		t.Fatalf("serve: %v", err)
	}
	if len(exec.commands) != 6 {
		t.Fatalf("executed %d commands, want 6", len(exec.commands))
	}
	acks := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(acks) != 6 {
		t.Fatalf("got %d acks, want 6: %q", len(acks), out.String())
	}
	for _, ack := range acks {
		if ack != `{"ok":true}` {
			t.Fatalf("ack = %s", ack)
		}
	}
}

func TestServeConnRejectsAndContinues(t *testing.T) {
	input := `{"type":"screenshot"}` + "\n" + `{"type":"mousemove","x":1,"y":1}` + "\n"
	var out bytes.Buffer
	exec := &recordingExecutor{}
	if err := serveConn(strings.NewReader(input), &out, exec); err != nil {
		t.Fatalf("serve: %v", err)
	}
	if len(exec.commands) != 1 {
		t.Fatalf("executed %d commands, want 1", len(exec.commands))
	}
	acks := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(acks) != 2 || !strings.Contains(acks[0], "invalid_command") || acks[1] != `{"ok":true}` {
		t.Fatalf("acks = %v", acks)
	}
}

func TestServeConnClosesOnOversizeLine(t *testing.T) {
	// A command line longer than 4 KiB is a protocol violation: the
	// connection closes without an ack and nothing executes.
	big := `{"type":"mousemove","x":1,"y":1,"pad":"` + strings.Repeat("a", MaxCommandBytes) + `"}`
	var out bytes.Buffer
	exec := &recordingExecutor{}
	err := serveConn(strings.NewReader(big+"\n"), &out, exec)
	if !errors.Is(err, ErrLineTooLong) {
		t.Fatalf("serve error = %v, want ErrLineTooLong", err)
	}
	if len(exec.commands) != 0 {
		t.Fatalf("executed %d commands, want 0", len(exec.commands))
	}
	if out.Len() != 0 {
		t.Fatalf("wrote %d bytes, want 0", out.Len())
	}
}

func TestServeConnEOFWithoutNewline(t *testing.T) {
	var out bytes.Buffer
	exec := &recordingExecutor{}
	if err := serveConn(strings.NewReader(`{"type":"keyup","key":"Escape"}`), &out, exec); err != nil {
		t.Fatalf("serve: %v", err)
	}
	if len(exec.commands) != 1 || exec.commands[0].Key != "Escape" {
		t.Fatalf("commands = %+v", exec.commands)
	}
}

func TestServeConnExecutorFailureAcks(t *testing.T) {
	var out bytes.Buffer
	exec := &recordingExecutor{fail: true}
	err := serveConn(strings.NewReader(`{"type":"mousemove","x":1,"y":1}`+"\n"), &out, exec)
	if err != nil {
		t.Fatalf("serve: %v", err)
	}
	if !strings.Contains(out.String(), "execute_failed") {
		t.Fatalf("ack = %q", out.String())
	}
}
