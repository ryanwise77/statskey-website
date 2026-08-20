//go:build windows

package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"unsafe"

	"golang.org/x/sys/windows"
)

// The helper listens on a byte-mode named pipe with a NULL security
// descriptor, so the default DACL grants access to the creating console user
// and SYSTEM only. PIPE_REJECT_REMOTE_CLIENTS keeps it local. It must be
// spawned by the StatsKey desktop as the console user; never run it elevated
// or as a service — injected input would then cross integrity levels.

const (
	pipeAccessDuplex        = 0x00000003
	pipeTypeByte            = 0x00000000
	pipeReadmodeByte        = 0x00000000
	pipeWait                = 0x00000000
	pipeRejectRemoteClients = 0x00000008
	errorPipeConnected      = 536
	invalidHandleValue      = ^uintptr(0)
)

var (
	procCreateNamedPipeW    = windows.NewLazySystemDLL("kernel32.dll").NewProc("CreateNamedPipeW")
	procConnectNamedPipe    = windows.NewLazySystemDLL("kernel32.dll").NewProc("ConnectNamedPipe")
	procDisconnectNamedPipe = windows.NewLazySystemDLL("kernel32.dll").NewProc("DisconnectNamedPipe")
	procSendInput           = windows.NewLazySystemDLL("user32.dll").NewProc("SendInput")
	procGetSystemMetrics    = windows.NewLazySystemDLL("user32.dll").NewProc("GetSystemMetrics")
)

// pipeConn adapts a blocking named-pipe handle to io.ReadWriter.
type pipeConn struct {
	h windows.Handle
}

func (c pipeConn) Read(p []byte) (int, error) {
	var done uint32
	err := windows.ReadFile(c.h, p, &done, nil)
	if done > 0 {
		return int(done), nil
	}
	if err != nil {
		if err == windows.ERROR_BROKEN_PIPE || err == windows.ERROR_PIPE_NOT_CONNECTED {
			return 0, io.EOF
		}
		return 0, err
	}
	return 0, nil
}

func (c pipeConn) Write(p []byte) (int, error) {
	var done uint32
	err := windows.WriteFile(c.h, p, &done, nil)
	if err != nil {
		if err == windows.ERROR_BROKEN_PIPE || err == windows.ERROR_NO_DATA ||
			err == windows.ERROR_PIPE_NOT_CONNECTED {
			return int(done), io.ErrClosedPipe
		}
		return int(done), err
	}
	return int(done), nil
}

// listenAndServe accepts one pipe client at a time, forever. Each client
// disconnect recreates the pipe so a stale client cannot hold the name.
func listenAndServe(pipeName string, exec Executor) error {
	name, err := windows.UTF16PtrFromString(pipeName)
	if err != nil {
		return err
	}
	for {
		h, _, err := procCreateNamedPipeW.Call(
			uintptr(unsafe.Pointer(name)),
			pipeAccessDuplex,
			pipeTypeByte|pipeReadmodeByte|pipeWait|pipeRejectRemoteClients,
			1,          // one instance: exactly one desktop runtime owns input
			4096, 4096, // out/in buffer hints
			0,
			0, // NULL security attributes: default DACL (current user + SYSTEM)
		)
		if h == invalidHandleValue {
			return fmt.Errorf("inputd: CreateNamedPipeW: %w", err)
		}
		handle := windows.Handle(h)
		r, _, cerr := procConnectNamedPipe.Call(uintptr(handle), 0)
		if r == 0 && cerr != windows.Errno(errorPipeConnected) {
			windows.CloseHandle(handle)
			return fmt.Errorf("inputd: ConnectNamedPipe: %w", cerr)
		}
		conn := pipeConn{h: handle}
		serveConn(conn, conn, exec)
		procDisconnectNamedPipe.Call(uintptr(handle))
		windows.CloseHandle(handle)
	}
}

// ---------------------------------------------------------------------------
// SendInput executor
// ---------------------------------------------------------------------------

const (
	inputMouse    = 0
	inputKeyboard = 1

	mouseEventfMove        = 0x0001
	mouseEventfLeftDown    = 0x0002
	mouseEventfLeftUp      = 0x0004
	mouseEventfRightDown   = 0x0008
	mouseEventfRightUp     = 0x0010
	mouseEventfMiddleDown  = 0x0020
	mouseEventfMiddleUp    = 0x0040
	mouseEventfWheel       = 0x0800
	mouseEventfHWheel      = 0x01000
	mouseEventfAbsolute    = 0x8000
	mouseEventfVirtualDesk = 0x4000

	keyEventfKeyUp = 0x0002

	smCXScreen = 0
	smCYScreen = 1
)

// inputEvent mirrors the Windows INPUT union on 64-bit: 4-byte type, 4-byte
// padding, then a 32-byte union (MOUSEINPUT is 28, KEYBDINPUT is 24).
type inputEvent struct {
	typ  uint32
	_    uint32
	data [32]byte
}

func mouseEvent(dx, dy int32, mouseData uint32, flags uint32) inputEvent {
	var ev inputEvent
	ev.typ = inputMouse
	binary.LittleEndian.PutUint32(ev.data[0:4], uint32(dx))
	binary.LittleEndian.PutUint32(ev.data[4:8], uint32(dy))
	binary.LittleEndian.PutUint32(ev.data[8:12], mouseData)
	binary.LittleEndian.PutUint32(ev.data[12:16], flags)
	return ev
}

func keyEvent(vk uint16, keyUp bool) inputEvent {
	var ev inputEvent
	ev.typ = inputKeyboard
	binary.LittleEndian.PutUint16(ev.data[0:2], vk)
	if keyUp {
		binary.LittleEndian.PutUint32(ev.data[4:8], keyEventfKeyUp)
	}
	return ev
}

func sendInput(events ...inputEvent) error {
	if len(events) == 0 {
		return nil
	}
	sent, _, err := procSendInput.Call(
		uintptr(len(events)),
		uintptr(unsafe.Pointer(&events[0])),
		unsafe.Sizeof(events[0]),
	)
	if sent != uintptr(len(events)) {
		if err != nil && err != windows.ERROR_SUCCESS {
			return fmt.Errorf("inputd: SendInput: %w", err)
		}
		return errors.New("inputd: SendInput did not consume every event")
	}
	return nil
}

func systemMetric(index int32) int32 {
	r, _, _ := procGetSystemMetrics.Call(uintptr(index))
	return int32(r)
}

// absolutePoint maps host screen pixels to SendInput's normalized absolute
// coordinate space (0..65535 over the primary display).
func absolutePoint(x, y int) (int32, int32) {
	w := int(systemMetric(smCXScreen))
	h := int(systemMetric(smCYScreen))
	if w < 1 {
		w = 1
	}
	if h < 1 {
		h = 1
	}
	ax := int64(x) * 65535 / int64(w-1)
	ay := int64(y) * 65535 / int64(h-1)
	if w == 1 {
		ax = 0
	}
	if h == 1 {
		ay = 0
	}
	return int32(ax), int32(ay)
}

func moveFlags() uint32 {
	return mouseEventfMove | mouseEventfAbsolute | mouseEventfVirtualDesk
}

func buttonFlags(button string) (down, up uint32, err error) {
	switch button {
	case "left":
		return mouseEventfLeftDown, mouseEventfLeftUp, nil
	case "middle":
		return mouseEventfMiddleDown, mouseEventfMiddleUp, nil
	case "right":
		return mouseEventfRightDown, mouseEventfRightUp, nil
	}
	return 0, 0, ErrBadButton
}

// sendInputExecutorForPlatform returns the SendInput-backed Executor.
func sendInputExecutorForPlatform() Executor { return sendInputExecutor{} }

// sendInputExecutor is the Windows Executor: validated commands become
// SendInput batches targeting the console session's primary display.
type sendInputExecutor struct{}

func (sendInputExecutor) Execute(cmd Command) error {
	switch cmd.Type {
	case CmdMouseMove:
		dx, dy := absolutePoint(cmd.X, cmd.Y)
		return sendInput(mouseEvent(dx, dy, 0, moveFlags()))
	case CmdMouseDown, CmdMouseUp:
		down, up, err := buttonFlags(cmd.Button)
		if err != nil {
			return err
		}
		flag := down
		if cmd.Type == CmdMouseUp {
			flag = up
		}
		dx, dy := absolutePoint(cmd.X, cmd.Y)
		return sendInput(
			mouseEvent(dx, dy, 0, moveFlags()),
			mouseEvent(dx, dy, 0, flag|mouseEventfAbsolute|mouseEventfVirtualDesk),
		)
	case CmdWheel:
		dx, dy := absolutePoint(cmd.X, cmd.Y)
		events := []inputEvent{mouseEvent(dx, dy, 0, moveFlags())}
		if cmd.DeltaY != 0 {
			events = append(events, mouseEvent(dx, dy, uint32(int32(cmd.DeltaY)),
				mouseEventfWheel|mouseEventfAbsolute|mouseEventfVirtualDesk))
		}
		if cmd.DeltaX != 0 {
			events = append(events, mouseEvent(dx, dy, uint32(int32(cmd.DeltaX)),
				mouseEventfHWheel|mouseEventfAbsolute|mouseEventfVirtualDesk))
		}
		return sendInput(events...)
	case CmdKeyDown, CmdKeyUp:
		vk, ok := keyVirtualCodes[cmd.Key]
		if !ok {
			return ErrBadKey
		}
		return sendInput(keyEvent(vk, cmd.Type == CmdKeyUp))
	}
	return ErrUnknownType
}
