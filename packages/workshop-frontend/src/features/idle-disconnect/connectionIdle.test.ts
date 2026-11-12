// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConnectionIdle, type ConnectionIdle } from './connectionIdle'

const HIDDEN_MS = 5 * 60_000
const INACTIVE_MS = 10 * 60_000

let visibility: DocumentVisibilityState = 'visible'
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state
  document.dispatchEvent(new Event('visibilitychange'))
}
const press = () => window.dispatchEvent(new KeyboardEvent('keydown'))

describe('createConnectionIdle', () => {
  let idle: ConnectionIdle
  const onIdle = vi.fn<() => void>()

  beforeEach(() => {
    vi.useFakeTimers()
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    onIdle.mockReset()
    idle = createConnectionIdle({ hiddenMs: HIDDEN_MS, inactiveMs: INACTIVE_MS, onIdle })
  })

  afterEach(() => {
    idle.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('goes idle once hidden for hiddenMs, and not if shown again first', () => {
    setVisibility('hidden')
    vi.advanceTimersByTime(HIDDEN_MS - 1)
    setVisibility('visible')
    vi.advanceTimersByTime(HIDDEN_MS)
    expect(onIdle).not.toHaveBeenCalled()

    setVisibility('hidden')
    vi.advanceTimersByTime(HIDDEN_MS)
    expect(onIdle).toHaveBeenCalledOnce()
    expect(idle.isPaused()).toBe(true)
  })

  it('goes idle after inactiveMs without input while visible, counting from the last input', () => {
    vi.advanceTimersByTime(INACTIVE_MS - 1000)
    press()
    vi.advanceTimersByTime(INACTIVE_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('resumes a tab paused for inactivity on the next input', async () => {
    const listener = vi.fn<() => void>()
    idle.subscribe(listener)
    vi.advanceTimersByTime(INACTIVE_MS)
    const active = vi.fn<() => void>()
    void idle.whenActive().then(active)
    await Promise.resolve()
    expect(active).not.toHaveBeenCalled()

    press()
    await Promise.resolve()
    expect(active).toHaveBeenCalledOnce()
    expect(idle.isPaused()).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('waits for the tab to be shown before reporting it active', async () => {
    setVisibility('hidden')
    const active = vi.fn<() => void>()
    void idle.whenActive().then(active)
    press()
    await Promise.resolve()
    expect(active).not.toHaveBeenCalled()

    setVisibility('visible')
    await Promise.resolve()
    expect(active).toHaveBeenCalledOnce()
  })

  it('defers idleness while held, and counts the release as activity', () => {
    const release = idle.hold()
    setVisibility('hidden')
    vi.advanceTimersByTime(INACTIVE_MS * 3)
    expect(onIdle).not.toHaveBeenCalled()

    setVisibility('visible')
    vi.advanceTimersByTime(INACTIVE_MS * 3)
    release()
    release()
    vi.advanceTimersByTime(INACTIVE_MS - 1)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onIdle).toHaveBeenCalledOnce()
  })

  it('goes idle at once on pagehide, even while held, and resumes on pageshow', async () => {
    idle.hold()
    window.dispatchEvent(new Event('pagehide'))
    expect(onIdle).toHaveBeenCalledOnce()

    const active = vi.fn<() => void>()
    void idle.whenActive().then(active)
    window.dispatchEvent(new Event('pageshow'))
    await Promise.resolve()
    expect(active).toHaveBeenCalledOnce()
  })

  it('stops listening once stopped', () => {
    idle.stop()
    setVisibility('hidden')
    vi.advanceTimersByTime(HIDDEN_MS)
    window.dispatchEvent(new Event('pagehide'))
    expect(onIdle).not.toHaveBeenCalled()
  })
})
