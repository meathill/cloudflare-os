import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AdminApi, BillingAdminClient } from '@gadgets/workshop-shared/api'
import type { BillingAccountInfo } from '@gadgets/workshop-shared/billing'

/** The billing side of the admin user list: null while loading or when the deployment has no billing. */
export type BillingAdmin = {
  api: RpcStub<BillingAdminClient>
  /**
   * Billing accounts by user key, for the keys looked up so far: null for a user who has none yet
   * (a standard user with no balance), absent for one still loading.
   */
  accounts: ReadonlyMap<string, BillingAccountInfo | null>
  /** Record an account the server returned after a change. */
  replace: (account: BillingAccountInfo) => void
}

/** A user key that has no billing account yet: what the billing Worker creates on first sight. */
export const emptyAccount = (userKey: string): BillingAccountInfo => ({
  userKey, plan: 'standard', balanceUsd: 0, rawCostTotalUsd: 0, chargedTotalUsd: 0,
  markup: null, effectiveMarkup: 0, topUpTotalUsd: 0, createdAt: 0, updatedAt: 0,
})

/** The billing admin capability alone: null while loading or when the deployment has no billing. */
export const useBillingAdminApi = (admin: RpcStub<AdminApi>): RpcStub<BillingAdminClient> | null => {
  // Wrapped in an object: a stub is callable, which useState would mistake for an updater.
  const [billing, setBilling] = useState<{ api: RpcStub<BillingAdminClient> } | null>(null)
  useEffect(() => {
    let disposed = false
    let stub: RpcStub<BillingAdminClient> | null = null
    admin.getBillingAdmin().then((api) => {
      if (disposed) return api?.[Symbol.dispose]()
      stub = api
      setBilling(api ? { api } : null)
    }).catch(() => {})
    return () => {
      disposed = true
      stub?.[Symbol.dispose]()
    }
  }, [admin])
  return billing?.api ?? null
}

/**
 * Looks up the accounts of `userKeys` (one page of the user list, at most
 * BILLING_ACCOUNTS_PER_REQUEST), keeping those of earlier pages.
 */
export const useBillingAccounts = (
  api: RpcStub<BillingAdminClient> | undefined,
  userKeys: readonly string[],
): Pick<BillingAdmin, 'accounts' | 'replace'> => {
  const [accounts, setAccounts] = useState<ReadonlyMap<string, BillingAccountInfo | null>>(new Map())

  // A string, so that the lookup reruns when the page's users change rather than on every render.
  const keysKey = userKeys.join('\n')
  useEffect(() => {
    const keys = keysKey ? keysKey.split('\n') : []
    if (!api || keys.length === 0) return
    let cancelled = false
    api.getAccounts(keys).then((rows) => {
      if (cancelled) return
      const found = new Map(rows.map((row) => [row.userKey, row]))
      setAccounts((current) => {
        const next = new Map(current)
        for (const key of keys) next.set(key, found.get(key) ?? null)
        return next
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [api, keysKey])

  return {
    accounts,
    replace: (account) => setAccounts((current) => new Map(current).set(account.userKey, account)),
  }
}
