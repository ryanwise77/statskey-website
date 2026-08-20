package relay

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Relay framing: every frame on the wire is
//
//	uint32 big-endian length || byte type || payload
//
// where length covers the type byte plus payload. The hello and the relay's
// own responses are FrameControl frames carrying canonical JSON. Everything
// the endpoints exchange after pairing (session control, video, input) is
// AES-256-GCM ciphertext under the session key; the relay forwards those
// frames without inspecting the payload.
const (
	// FrameControl carries plaintext canonical JSON between an endpoint and
	// the relay itself (hello, waiting, paired, error). Endpoints must not
	// send control frames after the handshake; the relay never forwards them.
	FrameControl = 0x00
	// FrameSessionControl carries encrypted endpoint control messages
	// (stream header, end-of-stream) and is forwarded opaquely.
	FrameSessionControl = 0x01
	// FrameVideo carries encrypted JPEG screen frames, host → viewer.
	FrameVideo = 0x02
	// FrameInput carries encrypted input events, viewer → host.
	FrameInput = 0x03
)

const (
	// MaxFrameBytes is the hard bound for one frame including its type byte.
	MaxFrameBytes = 2 * 1024 * 1024
	// MaxControlBytes bounds plaintext control frames; hellos and relay
	// responses are small and anything larger is an attack or a bug.
	MaxControlBytes = 16 * 1024
)

var (
	ErrFrameTooLarge = errors.New("relay: frame exceeds 2 MiB")
	ErrFrameShort    = errors.New("relay: frame too short")
	ErrFrameType     = errors.New("relay: unknown frame type")
)

// ForwardedType reports whether typ is an opaque endpoint frame type the
// relay forwards between host and viewer.
func ForwardedType(typ byte) bool {
	return typ == FrameSessionControl || typ == FrameVideo || typ == FrameInput
}

// WriteFrame writes one length-prefixed typed frame.
func WriteFrame(w io.Writer, typ byte, payload []byte) error {
	n := len(payload) + 1
	if n > MaxFrameBytes {
		return ErrFrameTooLarge
	}
	var hdr [5]byte
	binary.BigEndian.PutUint32(hdr[:4], uint32(n))
	hdr[4] = typ
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

// ReadFrame reads one frame, rejecting anything over max bytes (counting the
// type byte) before allocating. The full frame is read before returning;
// partial frames are errors.
func ReadFrame(r io.Reader, max uint32) (byte, []byte, error) {
	if max < 1 || max > MaxFrameBytes {
		max = MaxFrameBytes
	}
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return 0, nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > max {
		return 0, nil, ErrFrameTooLarge
	}
	if n < 1 {
		return 0, nil, ErrFrameShort
	}
	body := make([]byte, n)
	if _, err := io.ReadFull(r, body); err != nil {
		return 0, nil, fmt.Errorf("relay: short frame: %w", err)
	}
	return body[0], body[1:], nil
}
