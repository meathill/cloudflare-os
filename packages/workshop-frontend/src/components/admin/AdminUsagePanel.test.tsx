// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { AdminApi, UsageStatsResponse, UserUsageRecord } from '@gadgets/workshop-shared/api'
import type { BillingAccountInfo, BillingPlan, BillingUsageReport, BillingUsageReportQuery, BillingUsageTotals } from '@gadgets/workshop-shared/billing'
import { BILLING_LAUNCH_DAY, LEGACY_COST_FROZEN_DAY } from '../../features/billing/admin/legacyUsage'

vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
}))

import AdminUsagePanel from './AdminUsagePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Kumo Tabs 依赖 ResizeObserver，jsdom 没有。
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
})

const user = (username: string): UserUsageRecord => ({
  username, displayName: username, createdAt: '', lastActive: '', totalTokens: 0, estimatedCost: 0,
  callCount: 0, workspaceCount: 0,
})

const account = (userKey: string, plan: BillingPlan, balanceUsd = 0): BillingAccountInfo => ({
  userKey, plan, balanceUsd, rawCostTotalUsd: 0, chargedTotalUsd: 0,
  markup: null, effectiveMarkup: 2, topUpTotalUsd: 0, createdAt: 1, updatedAt: 1,
})

const totals = (overrides: Partial<BillingUsageTotals> = {}): BillingUsageTotals => ({
  requests: 3, inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 0,
  rawCostUsd: 0.01, chargedUsd: 0.02, platformCostUsd: 0, ...overrides,
})

const report = (overrides: Partial<BillingUsageReport> = {}): BillingUsageReport => ({
  range: { from: '2026-01-01', to: '2026-01-30' },
  totals: totals(),
  byModel: [{ ...totals(), model: 'google/gemini-4-hydrogen' }],
  byUser: [{ ...totals(), userKey: 'a@x.com' }],
  bySource: [{ ...totals(), source: 'chat' }],
  byDay: [{ ...totals(), day: '2026-01-15' }],
  ledger: [{ kind: 'topup', amountUsd: 25, count: 2 }],
  ...overrides,
})

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

describe('AdminUsagePanel billing', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    vi.restoreAllMocks()
  })

  const render = async (
    users: string[],
    accounts: BillingAccountInfo[],
    billingReport: BillingUsageReport | null = report(),
    extras: { totalCost?: number; legacyReport?: BillingUsageReport;
      estimatedCosts?: Record<string, number> } = {},
  ) => {
    const setPlan = vi.fn<(userKey: string, plan: BillingPlan) => Promise<BillingAccountInfo>>(
      async (userKey, plan) => account(userKey, plan))
    const getAccounts = vi.fn<(userKeys: string[]) => Promise<BillingAccountInfo[]>>(
      async (userKeys) => accounts.filter((a) => userKeys.includes(a.userKey)))
    const getUsageReport = vi.fn<(query: BillingUsageReportQuery) => Promise<BillingUsageReport>>(
      async (query) => (query.from === BILLING_LAUNCH_DAY ? extras.legacyReport : billingReport) ?? report())
    const listLedgerEntries = vi.fn<() => Promise<[]>>(async () => [])
    const billing = billingReport === null ? null : {
      getAccounts, setPlan, getUsageReport, listLedgerEntries,
      setMarkup: async () => account('x', 'standard'), grant: async () => account('x', 'standard'),
      listLedger: async () => [], listUsageEvents: async () => [],
      [Symbol.dispose]: () => {},
    }
    const stats: UsageStatsResponse = {
      overview: { totalUsers: users.length, totalWorkspaces: 7, totalTokens: 0,
        totalCost: extras.totalCost ?? 0, totalCalls: 0 },
      users: users.map((name) => ({
        ...user(name), estimatedCost: extras.estimatedCosts?.[name] ?? 0,
      })),
    }
    const admin = { getUsageStats: async () => stats, getBillingAdmin: async () => billing } as unknown as RpcStub<AdminApi>
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root!.render(<AdminUsagePanel admin={admin} />))
    await flush()
    return { setPlan, getAccounts, getUsageReport }
  }

  // 页面上还有按模型等其他表，用户行用用户名识别。
  const userRows = () =>
    [...container!.querySelectorAll('tbody tr')].filter((tr) => tr.textContent?.includes('@x.com'))
  const row = (username: string) => userRows().find((tr) => tr.textContent?.includes(username))!

  it('renders the billing report overview and model rows', async () => {
    const { getUsageReport } = await render(['a@x.com'], [account('a@x.com', 'standard', 3)])
    expect(getUsageReport).toHaveBeenCalled()
    const text = container!.textContent!
    expect(text).toContain('计费概览')
    expect(text).toContain('Gemini 4 Hydrogen')
    expect(text).toContain('google/gemini-4-hydrogen')
    expect(text).toContain('$0.0200')
    expect(text).toContain('$25.0000')
    // 按用户聚合：a@x.com 的区间请求与扣费。
    expect(row('a@x.com').textContent).toContain('1,700')
  })

  it('shows platform cost, the pre-billing estimate and gross margin excluding platform cost', async () => {
    // 旧统计累计 $10，上线到冻结日的对话成本 $3 → 计费上线前 $7。
    // 毛利新口径：$2 − ($1 − $0.4) = $1.4。
    const { getUsageReport } = await render(['a@x.com'], [], report({
      totals: totals({ rawCostUsd: 1, chargedUsd: 2, platformCostUsd: 0.4 }),
      bySource: [{ ...totals({ rawCostUsd: 1, platformCostUsd: 0.4 }), source: 'chat' }],
    }), {
      totalCost: 10,
      legacyReport: report({
        totals: totals({ rawCostUsd: 3 }),
        bySource: [{ ...totals({ rawCostUsd: 3 }), source: 'chat' }],
      }),
    })
    // 固定区间那次调用按 chat 来源过滤——title / web-search 也挂在用户名下，不能算进旧统计口径。
    expect(getUsageReport).toHaveBeenCalledWith(
      { from: BILLING_LAUNCH_DAY, to: LEGACY_COST_FROZEN_DAY, source: 'chat' })
    const text = container!.textContent!
    expect(text).toContain('平台承担')
    expect(text).toContain('$0.4000')
    expect(text).toContain('$1.4000')
    expect(text).toContain('计费上线前（估算）')
    expect(text).toContain('$7.0000')
    expect(text).toContain('旧统计累计 $10.0000')
    expect(text).toContain('不随时间范围变化')
  })

  it('shows each user their own pre-billing estimate, floored at zero', async () => {
    // a：旧统计 $10 − 上线后对话 $3 = $7；b：旧统计 $1 − 对话 $5 → 不为负 $0。
    await render(['a@x.com', 'b@x.com'], [], report({
      byUser: [
        { ...totals(), userKey: 'a@x.com' },
        { ...totals({ rawCostUsd: 0.4, chargedUsd: 0.5 }), userKey: 'b@x.com' },
      ],
    }), {
      estimatedCosts: { 'a@x.com': 10, 'b@x.com': 1 },
      legacyReport: report({
        totals: totals({ rawCostUsd: 8 }),
        byUser: [
          { ...totals({ rawCostUsd: 3 }), userKey: 'a@x.com' },
          { ...totals({ rawCostUsd: 5 }), userKey: 'b@x.com' },
        ],
      }),
    })
    expect(container!.textContent).toContain('计费上线前')
    expect(row('a@x.com').textContent).toContain('$7.0000')
    // b 的其他计费列都不为 $0.0000，这个值只可能来自「计费上线前」列。
    expect(row('b@x.com').textContent).toContain('$0.0000')
  })

  it('shows only the behavior table when billing is unavailable', async () => {
    await render(['a@x.com'], [], null)
    const text = container!.textContent!
    expect(text).not.toContain('计费概览')
    expect(text).not.toContain('Gemini 4 Hydrogen')
    expect(text).toContain('用户用量明细')
    expect(row('a@x.com')).toBeDefined()
  })

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

  // 回归：行为统计比报表请求晚返回时，旧闭包里的 reloadReport 不能把进行中的报表请求作废。
  it('keeps the in-flight report request when behavior stats resolve after it started', async () => {
    const deferred = <T,>() => {
      let resolve!: (value: T) => void
      const promise = new Promise<T>((r) => { resolve = r })
      return { promise, resolve }
    }
    const statsGate = deferred<UsageStatsResponse>()
    const reportGate = deferred<BillingUsageReport>()
    const billing = {
      getAccounts: vi.fn<() => Promise<BillingAccountInfo[]>>(async () => []),
      setPlan: async () => account('x', 'standard'),
      getUsageReport: vi.fn<() => Promise<BillingUsageReport>>(() => reportGate.promise),
      listLedgerEntries: async () => [],
      setMarkup: async () => account('x', 'standard'),
      grant: async () => account('x', 'standard'),
      listLedger: async () => [],
      listUsageEvents: async () => [],
      [Symbol.dispose]: () => {},
    }
    const stats: UsageStatsResponse = {
      overview: { totalUsers: 1, totalWorkspaces: 1, totalTokens: 0, totalCost: 0, totalCalls: 0 },
      users: [user('a@x.com')],
    }
    const admin = {
      getUsageStats: () => statsGate.promise,
      getBillingAdmin: async () => billing,
    } as unknown as RpcStub<AdminApi>
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => root!.render(<AdminUsagePanel admin={admin} />))
    // getBillingAdmin 先 resolve，useUsageReport 的 effect 发出报表请求。
    await flush()
    // 选中区间 + 「计费上线前」固定区间各一次。
    expect(billing.getUsageReport).toHaveBeenCalledTimes(2)
    // 行为统计此时才返回——旧代码会在这里用首次渲染的 reload 作废上面的请求。
    act(() => statsGate.resolve(stats))
    await flush()
    act(() => reportGate.resolve(report()))
    await flush()
    expect(container!.textContent).toContain('Gemini 4 Hydrogen')
    expect(container!.textContent).toContain('$0.0200')
  })

  it('pages through users, looking up billing for the page shown only', async () => {
    const users = Array.from({ length: 60 }, (_, i) => `u${String(i).padStart(2, '0')}@x.com`)
    const { getAccounts } = await render(users, [account('u55@x.com', 'internal', 7)])
    expect(userRows()).toHaveLength(50)
    expect(getAccounts.mock.calls.at(-1)![0]).toHaveLength(50)

    const next = container!.querySelector<HTMLButtonElement>('button[aria-label="下一页"]')!
    act(() => next.click())
    await flush()
    expect(userRows()).toHaveLength(10)
    expect(getAccounts.mock.calls.at(-1)![0]).toHaveLength(10)
    expect(row('u55@x.com').textContent).toContain('$7.00')
  })
})
