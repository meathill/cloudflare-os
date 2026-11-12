import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { RpcStub } from 'capnweb'
import type { BillingSummary, BillingUserApi } from '@gadgets/workshop-shared/billing'
import { useAuthenticatedApi } from '../../AuthContext'

/** The signed-in user's prepaid billing, or null while the deployment does not bill. */
export type BillingState = {
  api: RpcStub<BillingUserApi>
  /** Null until the first read lands. */
  summary: BillingSummary | null
  /** Re-read the balance, e.g. after a turn or a top-up. */
  refresh: () => void
}

const BillingContext = createContext<BillingState | null>(null)

/**
 * Holds the user's billing capability for the whole app, so the balance badge, the cost labels and
 * the out-of-credits dialog share one stub and one balance. Re-reads the balance on window focus,
 * which is when a user returns from Stripe Checkout.
 */
export const BillingProvider = ({ children }: { children: ReactNode }) => {
  const { authenticatedApi } = useAuthenticatedApi()
  // Wrapped in an object: a stub is callable, which useState would mistake for an updater.
  const [billing, setBilling] = useState<{ api: RpcStub<BillingUserApi> } | null>(null)
  const [summary, setSummary] = useState<BillingSummary | null>(null)
  const readVersion = useRef(0)

  useEffect(() => {
    let disposed = false
    let stub: RpcStub<BillingUserApi> | null = null
    authenticatedApi.getBilling().then((api) => {
      if (disposed) {
        api?.[Symbol.dispose]()
        return
      }
      stub = api
      setBilling(api ? { api } : null)
    }).catch(() => {})
    return () => {
      disposed = true
      stub?.[Symbol.dispose]()
      setBilling(null)
      setSummary(null)
    }
  }, [authenticatedApi])

  const api = billing?.api
  const refresh = useCallback(() => {
    if (!api) return
    const version = ++readVersion.current
    api.getSummary()
      .then((next) => { if (version === readVersion.current) setSummary(next) })
      .catch(() => {})
  }, [api])

  useEffect(() => {
    if (!api) return
    refresh()
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [api, refresh])

  return (
    <BillingContext.Provider value={api ? { api, summary, refresh } : null}>
      {children}
    </BillingContext.Provider>
  )
}

/** The user's billing, or null while the deployment does not bill (or before it is known). */
export const useBilling = (): BillingState | null => useContext(BillingContext)

/**
 * What the user pays per dollar of raw model cost: the markup for a standard user, 1 for an
 * internal one or while billing is off. Cost labels multiply raw costs by it.
 */
export const useCostMarkup = (): number => useBilling()?.summary?.markup ?? 1
