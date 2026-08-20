package daemon

import (
	"fmt"
	"net"
	"time"

	"statskey/fleetd/internal/wire"
)

// Client is the agent-side IPC client for the daemon control socket.
type Client struct {
	SocketPath string
	Timeout    time.Duration
}

// NewClient creates a client for the given socket path.
func NewClient(socketPath string) *Client {
	return &Client{SocketPath: socketPath, Timeout: 60 * time.Second}
}

// CallError carries the daemon's error code.
type CallError struct {
	Code    string
	Message string
}

func (e *CallError) Error() string { return e.Code + ": " + e.Message }

// Call issues one request (one connection per request, per the design).
func (c *Client) Call(method string, params map[string]any) (map[string]any, error) {
	body, err := wire.EncodeRequest(method, params)
	if err != nil {
		return nil, err
	}
	conn, err := net.DialTimeout("unix", c.SocketPath, c.Timeout)
	if err != nil {
		return nil, fmt.Errorf("daemon client: dial: %w", err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(c.Timeout))
	if err := wire.WriteFrame(conn, body); err != nil {
		return nil, fmt.Errorf("daemon client: write: %w", err)
	}
	respBody, err := wire.ReadFrame(conn)
	if err != nil {
		return nil, fmt.Errorf("daemon client: read: %w", err)
	}
	resp, err := wire.DecodeResponse(respBody)
	if err != nil {
		return nil, fmt.Errorf("daemon client: decode: %w", err)
	}
	if !resp.OK {
		return nil, &CallError{Code: resp.ErrCode, Message: resp.ErrMsg}
	}
	return resp.Result, nil
}
