package live

import (
	"context"
	"encoding/json"
	"sync"
	"time"

	"github.com/coder/websocket"
)

// A phone is expected to say something at least every few seconds (the app pings
// to measure the clock). Silence for this long means the connection is dead even
// if TCP has not noticed, which is common on mobile networks.
const (
	helloTimeout = 5 * time.Second
	readTimeout  = 40 * time.Second
	writeTimeout = 5 * time.Second
)

type conn struct {
	ws   *websocket.Conn
	seat int
	send chan []byte
	done chan struct{}
	once sync.Once

	// A simple token bucket, so a script cannot flood the room.
	bucket float64
	last   time.Time
}

func newConn(ws *websocket.Conn) *conn {
	return &conn{ws: ws, send: make(chan []byte, 64), done: make(chan struct{}), bucket: 60, last: time.Now()}
}

// trySend queues a message without ever blocking the room. A phone that cannot
// keep up is dropped; it reconnects and is caught up by the next full state.
func (c *conn) trySend(b []byte) {
	select {
	case <-c.done:
	case c.send <- b:
	default:
		c.close("too slow")
	}
}

func (c *conn) close(reason string) {
	c.once.Do(func() {
		close(c.done)
		_ = c.ws.Close(websocket.StatusPolicyViolation, reason)
	})
}

// closeSoon lets queued messages (like the final "closed") go out first.
func (c *conn) closeSoon() {
	go func() {
		time.Sleep(400 * time.Millisecond)
		c.once.Do(func() {
			close(c.done)
			_ = c.ws.Close(websocket.StatusNormalClosure, "room closed")
		})
	}()
}

func (c *conn) allow() bool {
	now := time.Now()
	c.bucket = min(60, c.bucket+now.Sub(c.last).Seconds()*30)
	c.last = now
	if c.bucket < 1 {
		return false
	}
	c.bucket--
	return true
}

func (c *conn) writeLoop(ctx context.Context) {
	for {
		select {
		case <-c.done:
			return
		case <-ctx.Done():
			return
		case b := <-c.send:
			wctx, cancel := context.WithTimeout(ctx, writeTimeout)
			err := c.ws.Write(wctx, websocket.MessageText, b)
			cancel()
			if err != nil {
				c.close("write failed")
				return
			}
		}
	}
}

// readMsg reads one message. A message that is not valid JSON is the sender's
// mistake and is reported as such; a failed read means the connection is gone.
func readMsg(ctx context.Context, ws *websocket.Conn) (m clientMsg, malformed bool, err error) {
	_, data, err := ws.Read(ctx)
	if err != nil {
		return m, false, err
	}
	if json.Unmarshal(data, &m) != nil {
		return clientMsg{}, true, nil
	}
	return m, false, nil
}

// Serve runs one phone's connection until it ends. The first thing the phone
// must say is hello, carrying its seat ticket; nothing is done for it before
// that, so an unauthenticated socket costs the server one read and a timeout.
func (r *Room) Serve(ctx context.Context, ws *websocket.Conn) {
	c := newConn(ws)
	ws.SetReadLimit(4096)
	defer c.close("bye")

	hctx, cancel := context.WithTimeout(ctx, helloTimeout)
	hello, malformed, err := readMsg(hctx, ws)
	cancel()
	if err != nil || malformed || hello.T != "hello" {
		_ = ws.Write(ctx, websocket.MessageText, errMsg("hello_required", "Say hello first."))
		return
	}
	if _, err := r.attach(hello.Token, c); err != nil {
		code := "bad_token"
		switch err {
		case ErrRoomClosed:
			code = "closed"
		case ErrSeatTaken:
			code = "seat_taken"
		}
		_ = ws.Write(ctx, websocket.MessageText, errMsg(code, err.Error()))
		return
	}
	defer r.detach(c)

	go c.writeLoop(ctx)

	for {
		rctx, cancel := context.WithTimeout(ctx, readTimeout)
		m, malformed, err := readMsg(rctx, ws)
		cancel()
		if err != nil {
			return
		}
		if !c.allow() {
			c.close("slow down")
			return
		}
		if malformed {
			// One bad message from one phone must not end anybody's game.
			c.trySend(errMsg("bad_message", "That message could not be understood."))
			continue
		}
		r.handle(c, m)
	}
}
