// Package relay implements the StatsKey Fleet remote-session relay: a TCP
// service that forwards opaque, end-to-end-encrypted frames between one host
// (the controlled machine) and one viewer (the controller). Both endpoints
// connect outbound; neither endpoint listens.
//
// Security model:
//
//   - Every endpoint authenticates with a RemoteHelloV1 (hello.go): canonical
//     JSON signed by its device key, binding session ID, role, and an expiry
//     of at most ten minutes. The relay verifies the signature against the
//     public key in the hello and binds the device ID to that key.
//   - The 256-bit session key is delivered to both endpoints by the control
//     plane over authenticated channels. Endpoints present only its SHA-256;
//     the relay stores and compares hashes and never sees the key.
//   - After pairing, every endpoint frame is AES-256-GCM ciphertext under the
//     session key. The relay enforces frame bounds and type bytes but cannot
//     read, mint, or alter payloads.
//   - Everything fails closed: unknown frame types, oversized frames, bad
//     signatures, expired hellos, duplicate roles, and key-hash mismatches
//     all terminate the connection.
package relay

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net"
	"sync"
	"time"

	"statskey/fleetd/internal/canon"
)

// Default limits. IdleTimeout and MaxSessionAge come from the Fleet remote
// session contract; the rest bound memory and handshake exposure.
const (
	DefaultIdleTimeout      = 10 * time.Minute
	DefaultMaxSessionAge    = 12 * time.Hour
	DefaultHandshakeTimeout = 15 * time.Second
	DefaultReapInterval     = time.Second
	DefaultMaxSessions      = 1024
)

// Rejection/closure codes sent to endpoints in error control frames.
const (
	CodeBadHello       = "bad_hello"
	CodeBadSignature   = "bad_signature"
	CodeHelloExpired   = "hello_expired"
	CodeDeviceMismatch = "device_mismatch"
	CodeDuplicateRole  = "duplicate_role"
	CodeKeyMismatch    = "session_key_mismatch"
	CodeRelayFull      = "relay_full"
	CodeBadFrameType   = "bad_frame_type"
	CodeFrameTooLarge  = "frame_too_large"
	CodeIdleTimeout    = "idle_timeout"
	CodeSessionMaxAge  = "session_max_age"
	CodeSessionClosed  = "session_closed"
	CodeRelayShutdown  = "relay_shutdown"
)

// Config tunes a Server. Zero values take the defaults above.
type Config struct {
	IdleTimeout      time.Duration
	MaxSessionAge    time.Duration
	HandshakeTimeout time.Duration
	ReapInterval     time.Duration
	MaxSessions      int
	Now              func() time.Time
	Logger           *log.Logger
}

func (c Config) withDefaults() Config {
	if c.IdleTimeout <= 0 {
		c.IdleTimeout = DefaultIdleTimeout
	}
	if c.MaxSessionAge <= 0 {
		c.MaxSessionAge = DefaultMaxSessionAge
	}
	if c.HandshakeTimeout <= 0 {
		c.HandshakeTimeout = DefaultHandshakeTimeout
	}
	if c.ReapInterval <= 0 {
		c.ReapInterval = DefaultReapInterval
	}
	if c.MaxSessions <= 0 {
		c.MaxSessions = DefaultMaxSessions
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	if c.Logger == nil {
		c.Logger = log.Default()
	}
	return c
}

// Server is a running relay. Use New and Serve.
type Server struct {
	cfg Config

	mu       sync.Mutex
	sessions map[string]*session
}

// New creates a relay server with the given configuration.
func New(cfg Config) *Server {
	return &Server{
		cfg:      cfg.withDefaults(),
		sessions: make(map[string]*session),
	}
}

// endpoint is one authenticated connection.
type endpoint struct {
	conn   net.Conn
	hello  *Hello
	role   string
	writeM sync.Mutex
}

func (e *endpoint) writeFrame(typ byte, payload []byte) error {
	e.writeM.Lock()
	defer e.writeM.Unlock()
	return WriteFrame(e.conn, typ, payload)
}

func (e *endpoint) writeControl(v map[string]any) error {
	b, err := canon.Encode(v)
	if err != nil {
		return err
	}
	return e.writeFrame(FrameControl, b)
}

func (e *endpoint) writeError(code, message string) {
	_ = e.writeControl(map[string]any{
		"type":    "error",
		"code":    code,
		"message": message,
	})
}

// session is one relayed pair (at most one host and one viewer).
type session struct {
	srv     *Server
	id      string
	keyHash string

	host   *endpoint
	viewer *endpoint

	paired       bool
	pairedAt     time.Time
	lastActivity time.Time

	closed    chan struct{}
	closeOnce sync.Once
}

func (s *session) isClosed() bool {
	select {
	case <-s.closed:
		return true
	default:
		return false
	}
}

// touch records forwarded-frame activity for the idle timeout.
func (s *session) touch() {
	s.srv.mu.Lock()
	s.lastActivity = s.srv.cfg.Now()
	s.srv.mu.Unlock()
}

// close terminates the session: closes both connections and removes the
// session from the registry. Safe to call from any goroutine, any number of
// times.
func (s *session) close() {
	s.closeOnce.Do(func() {
		close(s.closed)
		if s.host != nil {
			s.host.conn.Close()
		}
		if s.viewer != nil {
			s.viewer.conn.Close()
		}
		s.srv.removeSession(s)
	})
}

// closeWithCode notifies present endpoints, then closes.
func (s *session) closeWithCode(code, message string) {
	s.closeOnce.Do(func() {
		if s.host != nil {
			s.host.writeError(code, message)
		}
		if s.viewer != nil {
			s.viewer.writeError(code, message)
		}
		close(s.closed)
		if s.host != nil {
			s.host.conn.Close()
		}
		if s.viewer != nil {
			s.viewer.conn.Close()
		}
		s.srv.removeSession(s)
	})
}

// pump forwards frames from one endpoint to the other until error. Any
// protocol violation or I/O error closes the whole session.
func (s *session) pump(from, to *endpoint) {
	for {
		typ, payload, err := ReadFrame(from.conn, MaxFrameBytes)
		if err != nil {
			s.close()
			return
		}
		if !ForwardedType(typ) {
			from.writeError(CodeBadFrameType, "Frame type is not forwardable.")
			s.close()
			return
		}
		if err := to.writeFrame(typ, payload); err != nil {
			s.close()
			return
		}
		s.touch()
	}
}

var (
	errDuplicateRole = errors.New("relay: role already present for session")
	errKeyMismatch   = errors.New("relay: session key hash mismatch")
	errRelayFull     = errors.New("relay: too many sessions")
)

// Serve accepts connections until ctx is cancelled, then closes every
// session and returns.
func (s *Server) Serve(ctx context.Context, ln net.Listener) error {
	stop := make(chan struct{})
	defer close(stop)
	go s.reapLoop(stop)
	go func() {
		<-ctx.Done()
		ln.Close()
	}()
	for {
		conn, err := ln.Accept()
		if err != nil {
			if ctx.Err() != nil {
				s.closeAll()
				return nil
			}
			return err
		}
		go s.serveConn(conn)
	}
}

// SessionCount reports the number of registered sessions (tests and
// diagnostics).
func (s *Server) SessionCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.sessions)
}

func (s *Server) removeSession(sess *session) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.sessions[sess.id] == sess {
		delete(s.sessions, sess.id)
	}
}

func (s *Server) closeAll() {
	s.mu.Lock()
	all := make([]*session, 0, len(s.sessions))
	for _, sess := range s.sessions {
		all = append(all, sess)
	}
	s.mu.Unlock()
	for _, sess := range all {
		sess.close()
	}
}

// register places an authenticated endpoint into its session, pairing when
// both roles are present. On pairing it writes "paired" to both endpoints
// and starts the forwarding pumps.
func (s *Server) register(ep *endpoint) (*session, error) {
	s.mu.Lock()
	if existing := s.sessions[ep.hello.SessionID]; existing != nil && existing.isClosed() {
		delete(s.sessions, ep.hello.SessionID)
	}
	sess := s.sessions[ep.hello.SessionID]
	if sess == nil {
		if len(s.sessions) >= s.cfg.MaxSessions {
			s.mu.Unlock()
			return nil, errRelayFull
		}
		sess = &session{
			srv:     s,
			id:      ep.hello.SessionID,
			keyHash: ep.hello.SessionKeyHash,
			closed:  make(chan struct{}),
		}
		s.sessions[sess.id] = sess
	}
	if (ep.role == RoleHost && sess.host != nil) ||
		(ep.role == RoleViewer && sess.viewer != nil) {
		s.mu.Unlock()
		return nil, errDuplicateRole
	}
	if subtle.ConstantTimeCompare([]byte(sess.keyHash), []byte(ep.hello.SessionKeyHash)) != 1 {
		s.mu.Unlock()
		return nil, errKeyMismatch
	}
	if ep.role == RoleHost {
		sess.host = ep
	} else {
		sess.viewer = ep
	}
	now := s.cfg.Now()
	complete := sess.host != nil && sess.viewer != nil
	if complete {
		sess.paired = true
		sess.pairedAt = now
		sess.lastActivity = now
	}
	s.mu.Unlock()

	if !complete {
		return sess, nil
	}
	paired := func(e *endpoint) {
		_ = e.writeControl(map[string]any{
			"type":      "paired",
			"role":      e.role,
			"sessionId": sess.id,
		})
	}
	paired(sess.host)
	paired(sess.viewer)
	go sess.pump(sess.host, sess.viewer)
	go sess.pump(sess.viewer, sess.host)
	return sess, nil
}

// serveConn runs the handshake for one connection and then parks until the
// session ends. Forwarding happens in the session pumps.
func (s *Server) serveConn(conn net.Conn) {
	now := s.cfg.Now()
	if err := conn.SetDeadline(now.Add(s.cfg.HandshakeTimeout)); err != nil {
		conn.Close()
		return
	}
	typ, payload, err := ReadFrame(conn, MaxControlBytes+1)
	if err != nil || typ != FrameControl || len(payload) > MaxControlBytes {
		conn.Close()
		return
	}
	hello, err := DecodeHello(payload)
	if err != nil {
		ep := &endpoint{conn: conn}
		ep.writeError(CodeBadHello, "Hello is not valid.")
		conn.Close()
		return
	}
	if err := hello.Verify(s.cfg.Now()); err != nil {
		ep := &endpoint{conn: conn}
		code := CodeBadSignature
		switch {
		case errors.Is(err, ErrHelloExpired), errors.Is(err, ErrHelloLifetime):
			code = CodeHelloExpired
		case errors.Is(err, ErrDeviceMismatch):
			code = CodeDeviceMismatch
		}
		ep.writeError(code, "Hello verification failed.")
		conn.Close()
		return
	}
	// Handshake over: the idle reaper, not per-connection deadlines, governs
	// the rest of the lifetime.
	if err := conn.SetDeadline(time.Time{}); err != nil {
		conn.Close()
		return
	}
	ep := &endpoint{conn: conn, hello: hello, role: hello.Role}
	sess, err := s.register(ep)
	if err != nil {
		code := CodeDuplicateRole
		switch {
		case errors.Is(err, errKeyMismatch):
			code = CodeKeyMismatch
		case errors.Is(err, errRelayFull):
			code = CodeRelayFull
		}
		ep.writeError(code, "Session registration failed.")
		conn.Close()
		return
	}
	if !sess.paired {
		if err := ep.writeControl(map[string]any{
			"type":      "waiting",
			"role":      ep.role,
			"sessionId": sess.id,
		}); err != nil {
			sess.close()
			return
		}
	}
	<-sess.closed
}

// reapLoop closes idle, over-age, and expired-waiting sessions.
func (s *Server) reapLoop(stop chan struct{}) {
	ticker := time.NewTicker(s.cfg.ReapInterval)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			s.reap()
		}
	}
}

func (s *Server) reap() {
	now := s.cfg.Now()
	type doomed struct {
		sess *session
		code string
	}
	var list []doomed
	s.mu.Lock()
	for _, sess := range s.sessions {
		switch {
		case sess.paired && now.Sub(sess.lastActivity) > s.cfg.IdleTimeout:
			list = append(list, doomed{sess, CodeIdleTimeout})
		case sess.paired && now.Sub(sess.pairedAt) > s.cfg.MaxSessionAge:
			list = append(list, doomed{sess, CodeSessionMaxAge})
		case !sess.paired && waitingExpired(sess, now):
			list = append(list, doomed{sess, CodeHelloExpired})
		}
	}
	s.mu.Unlock()
	for _, d := range list {
		d.sess.closeWithCode(d.code, "Session closed by the relay.")
	}
}

// waitingExpired reports whether an unpaired session has outlived the hello
// expiry of every present endpoint.
func waitingExpired(sess *session, now time.Time) bool {
	expired := func(ep *endpoint) bool {
		return ep != nil && !ep.hello.ExpiresAt.After(now)
	}
	if sess.host == nil && sess.viewer == nil {
		return true
	}
	if sess.host != nil && !expired(sess.host) {
		return false
	}
	if sess.viewer != nil && !expired(sess.viewer) {
		return false
	}
	return true
}
