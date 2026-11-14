// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AdminApi, UsageStatsResponse, UserUsageRecord } from '@gadgets/workshop-shared/api'
import type { BillingAccountInfo, BillingPlan } from '@gadgets/workshop-shared/billing'

vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
}))

import AdminUsagePanel from './AdminUsagePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const user = (username: string): UserUsageRecord => ({
  username, displayName: username, createdAt: '', lastActive: '', totalTokens: 0, estimatedCost: 0,
  callCount: 0, workspaceCount: 0,
})

const account = (userKey: string, plan: BillingPlan, balanceUsd = 0): BillingAccountInfo => ({
  userKey, plan, balanceUsd, rawCostTotalUsd: 0, chargedTotalUsd: 0, createdAt: 1, updatedAt: 1,
})

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })

describe('AdminUsagePanel billing', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.restoreAllMocks()
  })

  const render = async (users: string[], accounts: BillingAccountInfo[]) => {
    const setPlan = vi.fn<(userKey: string, plan: BillingPlan) => Promise<BillingAccountInfo>>(
      async (userKey, plan) => account(userKey, plan))
    const getAccounts = vi.fn<(userKeys: string[]) => Promise<BillingAccountInfo[]>>(
      async (userKeys) => accounts.filter((a) => userKeys.includes(a.userKey)))
    const billing = { getAccounts, setPlan, [Symbol.dispose]: () => {} }
    const stats: UsageStatsResponse = {
      overview: { totalUsers: users.length, totalWorkspaces: 0, totalTokens: 0, totalCost: 0, totalCalls: 0 },
      users: users.map(user),
    }
    const admin = { getUsageStats: async () => stats, getBillingAdmin: async () => billing } as unknown as RpcStub<AdminApi>
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root!.render(<AdminUsagePanel admin={admin} />))
    await flush()
    return { setPlan, getAccounts }
  }

  const row = (username: string) =>
    [...container!.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes(username))!

  it('shows billing controls for users who have no billing account yet', async () => {
    await render(['a@x.com', 'b@x.com'], [account('a@x.com', 'internal', 3)])
    expect(row('a@x.com').textContent).toContain('$3.00')
    expect(row('a@x.com').textContent).toContain('内部')
    expect(row('b@x.com').textContent).toContain('$0.00')
    expect(row('b@x.com').textContent).toContain('普通')
  })

  it('marks every listed user internal', async () => {
    const { setPlan } = await render(['a@x.com', 'b@x.com'], [])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const button = [...container!.querySelectorAll('button')].find((b) => b.textContent === '全部设为内部')!
    act(() => button.click())
    await flush()
    expect(setPlan.mock.calls).toEqual([['a@x.com', 'internal'], ['b@x.com', 'internal']])
    expect(row('b@x.com').textContent).toContain('内部')
  })

  it('pages through users, looking up billing for the page shown only', async () => {
    const users = Array.from({ length: 60 }, (_, i) => `u${String(i).padStart(2, '0')}@x.com`)
    const { getAccounts } = await render(users, [account('u55@x.com', 'internal', 7)])
    expect(container!.querySelectorAll('tbody tr')).toHaveLength(50)
    expect(getAccounts.mock.calls.at(-1)![0]).toHaveLength(50)

    const next = container!.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')!
    act(() => next.click())
    await flush()
    expect(container!.querySelectorAll('tbody tr')).toHaveLength(10)
    expect(getAccounts.mock.calls.at(-1)![0]).toHaveLength(10)
    expect(row('u55@x.com').textContent).toContain('$7.00')
  })
})
