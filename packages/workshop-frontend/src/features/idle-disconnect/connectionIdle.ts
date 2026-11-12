/**
 * Decides when an unattended tab should drop its WebSocket, and when it may connect again.
 *
 * An open socket keeps the Workshop's Durable Objects (the open workspace's Overseer, the user's
 * own) holding an RPC session, so they cannot hibernate and bill wall-clock duration for as long as
 * the tab stays open, which for forgotten tabs means days. A tab counts as idle once it has been
 * hidden for `hiddenMs`, or visible with no user input for `inactiveMs`; `pagehide` / `freeze`
 * make it idle at once. A hold (a running agent, unsynced edits) defers idleness, and its release
 * counts as activity, so nobody watching the result is cut off the moment it arrives.
 */
export type ConnectionIdleOptions = {
  hiddenMs: number
  inactiveMs: number
  onIdle: () => void
}

export type ConnectionIdle = {
  /** Records user input. Resumes a tab paused for inactivity. */
  markActivity: () => void
  /** Defers idleness until the returned release is called. */
  hold: () => () => void
  /** Resolves once the tab is visible and not paused: when it may connect. */
  whenActive: () => Promise<void>
  isPaused: () => boolean
  /** Listens for changes to isPaused(). */
  subscribe: (listener: () => void) => () => void
  stop: () => void
}

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove', 'focus'] as const

const isVisible = () => document.visibilityState === 'visible'

export const createConnectionIdle = ({ hiddenMs, inactiveMs, onIdle }: ConnectionIdleOptions): ConnectionIdle => {
  let lastActivity = Date.now()
  let hiddenSince: number | null = isVisible() ? null : Date.now()
  let holds = 0
  let paused = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let waiters: (() => void)[] = []
  const listeners = new Set<() => void>()

  const flushWaiters = () => {
    if (paused || !isVisible()) return
    const ready = waiters
    waiters = []
    ready.forEach(resolve => resolve())
  }

  const setPaused = (value: boolean) => {
    if (paused === value) return
    paused = value
    listeners.forEach(listener => listener())
  }

  const pause = () => {
    clearTimeout(timer)
    if (paused) return
    setPaused(true)
    onIdle()
  }

  // Activity only moves `lastActivity`; a timer that fires early just re-arms for the remainder,
  // so a stream of mousemoves never touches the timer.
  const evaluate = () => {
    clearTimeout(timer)
    if (paused || holds > 0) return
    const due = hiddenSince === null ? lastActivity + inactiveMs : hiddenSince + hiddenMs
    const remaining = due - Date.now()
    if (remaining <= 0) pause()
    else timer = setTimeout(evaluate, remaining)
  }

  const markActivity = () => {
    lastActivity = Date.now()
    if (paused && isVisible()) {
      setPaused(false)
      flushWaiters()
      evaluate()
    }
  }

  const onVisibilityChange = () => {
    if (isVisible()) {
      hiddenSince = null
      markActivity()
      flushWaiters()
    } else {
      hiddenSince = Date.now()
    }
    evaluate()
  }

  ACTIVITY_EVENTS.forEach(type => window.addEventListener(type, markActivity, { capture: true, passive: true }))
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', pause)
  document.addEventListener('freeze', pause)
  window.addEventListener('pageshow', onVisibilityChange)
  document.addEventListener('resume', onVisibilityChange)
  evaluate()

  return {
    markActivity,
    hold: () => {
      holds++
      clearTimeout(timer)
      let released = false
      return () => {
        if (released) return
        released = true
        holds--
        if (holds === 0) lastActivity = Date.now()
        evaluate()
      }
    },
    whenActive: () => new Promise<void>(resolve => {
      waiters.push(resolve)
      flushWaiters()
    }),
    isPaused: () => paused,
    subscribe: listener => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    stop: () => {
      clearTimeout(timer)
      ACTIVITY_EVENTS.forEach(type => window.removeEventListener(type, markActivity, { capture: true }))
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', pause)
      document.removeEventListener('freeze', pause)
      window.removeEventListener('pageshow', onVisibilityChange)
      document.removeEventListener('resume', onVisibilityChange)
    },
  }
}

// The app's single instance, started by main.tsx with its connection. Holds and activity reported
// before it starts (or in tests that never start it) are dropped.
let instance: ConnectionIdle | null = null

export const startConnectionIdle = (options: ConnectionIdleOptions): ConnectionIdle => {
  instance?.stop()
  instance = createConnectionIdle(options)
  return instance
}

export const holdConnection = (): (() => void) => instance?.hold() ?? (() => {})

export const markConnectionActivity = () => instance?.markActivity()

export const isConnectionPaused = () => instance?.isPaused() ?? false

export const subscribeConnectionPaused = (listener: () => void): (() => void) =>
  instance?.subscribe(listener) ?? (() => {})
