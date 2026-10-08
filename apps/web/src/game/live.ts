// The phone's side of a live game: one WebSocket to the server, kept alive.
//
// It does four things and nothing else. It says hello with the seat ticket. It
// measures how far this phone's clock is from the server's, so countdowns line
// up on both phones. It reconnects when the line drops, which on a mobile
// network is routine, not exceptional. And it hands whatever arrives to the app.
// Everything about the match itself is decided on the server.

import type { ClientMessage, LiveView, RoomInfo, ServerMessage } from './wire'

export type LiveStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface Ticket {
  code: string
  seat: number
  token: string
  mode: 'live' | 'bot'
}

export interface LiveHandlers {
  onState(view: LiveView, room: RoomInfo, offset: number): void
  onStatus(status: LiveStatus): void
  /** The other player is typing; `until` is in this phone's clock. */
  onTyping(until: number): void
  onReaction(emoji: string): void
  onError(code: string, message: string): void
  /** The room ended. `reason` says why, in the server's words. */
  onClosed(reason: string): void
}

const BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

function socketUrl(code: string): string {
  const path = `/v1/rooms/${encodeURIComponent(code)}/ws`
  if (BASE) return BASE.replace(/^http/, 'ws') + path
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}${path}`
}

const SESSION_KEY = 'otb-room-v1'

/** The ticket lives in sessionStorage: it belongs to this tab, so two tabs of
 *  one browser can be two different players. */
export function saveTicket(ticket: Ticket | null) {
  try {
    if (ticket) sessionStorage.setItem(SESSION_KEY, JSON.stringify(ticket))
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage unavailable: the game works, a reload just can't rejoin */
  }
}

export function loadTicket(): Ticket | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    return raw ? (JSON.parse(raw) as Ticket) : null
  } catch {
    return null
  }
}

/** Codes the server sends when reconnecting can never work. */
const FATAL = new Set(['bad_token', 'closed', 'seat_taken', 'hello_required'])

export class LiveConnection {
  private ws: WebSocket | null = null
  private status: LiveStatus = 'idle'
  private stopped = false
  private attempt = 0
  private retry: number | undefined
  private pinger: number | undefined
  private samples: { rtt: number; offset: number }[] = []
  private fatal = false

  constructor(
    private readonly ticket: Ticket,
    private readonly h: LiveHandlers,
  ) {
    window.addEventListener('online', this.nudge)
    document.addEventListener('visibilitychange', this.nudge)
  }

  /** Server time minus this phone's time, from the quickest round trip seen. */
  get offset(): number {
    if (!this.samples.length) return 0
    return this.samples.reduce((best, s) => (s.rtt < best.rtt ? s : best)).offset
  }

  connect() {
    if (this.stopped) return
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    let ws: WebSocket
    try {
      ws = new WebSocket(socketUrl(this.ticket.code))
    } catch {
      this.scheduleRetry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.send({ t: 'hello', token: this.ticket.token })
      this.startPinging()
    }
    ws.onmessage = (ev) => this.receive(ev.data)
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = null
      window.clearInterval(this.pinger)
      if (!this.stopped && !this.fatal) this.scheduleRetry()
    }
    ws.onerror = () => {
      /* onclose follows, and handles it */
    }
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  /** Leave on purpose: the server frees the seat instead of waiting for us. */
  leave() {
    this.send({ t: 'leave' })
    this.close()
  }

  close() {
    this.stopped = true
    window.clearTimeout(this.retry)
    window.clearInterval(this.pinger)
    window.removeEventListener('online', this.nudge)
    document.removeEventListener('visibilitychange', this.nudge)
    const ws = this.ws
    this.ws = null
    ws?.close()
    this.setStatus('closed')
  }

  private setStatus(s: LiveStatus) {
    if (this.status === s) return
    this.status = s
    this.h.onStatus(s)
  }

  private receive(data: unknown) {
    let msg: ServerMessage
    try {
      msg = JSON.parse(String(data)) as ServerMessage
    } catch {
      return
    }
    switch (msg.t) {
      case 'state': {
        // Until a ping has come back, the best guess is the gap on this very
        // message. It includes the trip here, which the pings then remove.
        if (!this.samples.length) this.samples.push({ rtt: Infinity, offset: msg.v.now - Date.now() })
        this.setStatus('open')
        this.h.onState(msg.v, msg.room, this.offset)
        break
      }
      case 'pong': {
        const rtt = Date.now() - msg.c
        this.samples = [...this.samples.filter((s) => Number.isFinite(s.rtt)).slice(-9), { rtt, offset: msg.s - (msg.c + rtt / 2) }]
        break
      }
      case 'typing':
        this.h.onTyping(msg.until - this.offset)
        break
      case 'reaction':
        this.h.onReaction(msg.e)
        break
      case 'error':
        if (FATAL.has(msg.code)) this.fatal = true
        this.h.onError(msg.code, msg.message)
        if (this.fatal) this.close()
        break
      case 'closed':
        this.fatal = true
        this.h.onClosed(msg.reason)
        this.close()
        break
    }
  }

  private startPinging() {
    window.clearInterval(this.pinger)
    // A burst at the start finds the clock offset quickly; after that, a ping
    // every few seconds keeps it fresh and tells the server we are still here.
    let burst = 0
    const ping = () => this.send({ t: 'ping', c: Date.now() })
    ping()
    this.pinger = window.setInterval(() => {
      ping()
      burst += 1
      if (burst === 4) {
        window.clearInterval(this.pinger)
        this.pinger = window.setInterval(ping, 8000)
      }
    }, 250)
  }

  private scheduleRetry() {
    if (this.stopped) return
    this.setStatus('reconnecting')
    const wait = Math.min(8000, 500 * 2 ** this.attempt)
    this.attempt += 1
    window.clearTimeout(this.retry)
    this.retry = window.setTimeout(() => this.connect(), wait)
  }

  /** The phone came back to the foreground or the network returned: do not wait
   *  out the backoff, try now. */
  private nudge = () => {
    if (this.stopped || this.fatal) return
    if (document.visibilityState === 'hidden') return
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      window.clearTimeout(this.retry)
      this.attempt = 0
      this.connect()
    }
  }
}
