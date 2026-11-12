import { useEffect, useSyncExternalStore } from 'react'
import { holdConnection, isConnectionPaused, subscribeConnectionPaused } from './connectionIdle'

/** Keeps an unattended tab connected while `active` (see connectionIdle). */
export const useConnectionHold = (active: boolean) => {
  useEffect(() => (active ? holdConnection() : undefined), [active])
}

/** Whether the connection was dropped because the tab sat unattended. */
export const useConnectionPaused = () => useSyncExternalStore(subscribeConnectionPaused, isConnectionPaused)
