// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingSummary, BillingUserUsageRow } from '@gadgets/workshop-shared/billing'

const billingState = vi.hoisted(() => ({
  value: null as null | {
    api: {
      createCheckout: (tier: number) => Promise<{ url: string }>
      listLedger: () => Promise<[]>
      getUsage: (range: { from: string; to: string }) => Promise<BillingUserUsageRow[]>
    }
    summary: BillingSummary | null
    refresh: () => void
  },
}))

vi.mock('../../features/billing/BillingContext', () => ({ useBilling: () => billingState.value }))
vi.mock('../../features/ai-models/ModelPricingTable', () => ({
  ModelPricingTable: () => <div>模型价格表桩</div>,
}))
vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
}))

import BillingPage from './BillingPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const summary = (overrides: Partial<BillingSummary>): BillingSummary => ({
  plan: 'standard', balanceUsd: 1.5, topUpTiersUsd: [5, 10], topUpEnabled: true, ...overrides,
})

const usageRow = (overrides: Partial<BillingUserUsageRow>): BillingUserUsageRow => ({
  day: '2026-01-15', model: 'google/gemini-4-hydrogen', requests: 1,
  inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0,
  chargedUsd: 0.02, ...overrides,
})

describe('BillingPage', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    billingState.value = null
  })

  async function render(value: typeof billingState.value) {
    billingState.value = value
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root!.render(<BillingPage />))
    await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve() })
    return container
  }

  type Checkout = (tier: number) => Promise<{ url: string }>
  const api = (createCheckout = vi.fn<Checkout>(async () => ({ url: 'https://checkout.stripe.com/c/1' }))) => ({
    createCheckout, listLedger: async () => [] as [], getUsage: async () => [] as BillingUserUsageRow[],
  })

  it('offers each top-up tier to a standard user and sends them to Stripe Checkout', async () => {
    const createCheckout = vi.fn<Checkout>(async () => ({ url: 'https://checkout.stripe.com/c/1' }))
    const assign = vi.fn<(url: string) => void>()
    vi.stubGlobal('location', { ...window.location, assign })
    const page = await render({ api: api(createCheckout), summary: summary({}), refresh: () => {} })
    expect(page.textContent).toContain('$1.50')
    expect(page.textContent).toContain('按计费 Tokens × 官方单价扣费')
    const tier = [...page.querySelectorAll('button')].find((button) => button.textContent?.includes('$10'))!
    await act(async () => tier.click())
    expect(createCheckout).toHaveBeenCalledWith(10)
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/1')
    vi.unstubAllGlobals()
  })

  it('groups usage by day and model without exposing markup or raw cost', async () => {
    const getUsage = vi.fn<() => Promise<BillingUserUsageRow[]>>(async () => [
      usageRow({ day: '2026-01-15', model: 'google/gemini-4-hydrogen', chargedUsd: 0.02 }),
      usageRow({ day: '2026-01-15', model: 'openai/gpt-6.2-sol', chargedUsd: 0.04 }),
      usageRow({ day: '2026-01-14', model: 'web-search', chargedUsd: 0.01, inputTokens: 0, outputTokens: 0 }),
    ])
    const page = await render({ api: { ...api(), getUsage }, summary: summary({}), refresh: () => {} })
    expect(getUsage).toHaveBeenCalledOnce()
    expect(page.textContent).toContain('2026-01-15')
    expect(page.textContent).toContain('2026-01-14')
    expect(page.textContent).toContain('Gemini 4 Hydrogen')
    expect(page.textContent).toContain('GPT-6.2 Sol')
    expect(page.textContent).toContain('联网搜索')
    expect(page.textContent).toContain('$0.02')
    expect(page.textContent).not.toContain('倍率')
    expect(page.textContent).not.toContain('原始成本')
  })

  it('shows the empty usage state', async () => {
    const page = await render({ api: api(), summary: summary({}), refresh: () => {} })
    expect(page.textContent).toContain('这段时间没有用量。')
  })

  it('opens the model pricing guide from the balance card', async () => {
    const page = await render({ api: api(), summary: summary({}), refresh: () => {} })
    const link = [...page.querySelectorAll('button')]
      .find((button) => button.textContent === '查看模型价格')!
    await act(async () => link.click())
    // Dialog 渲染在 portal 里，查 document.body。
    expect(document.body.textContent).toContain('模型价格表桩')
  })

  it('shows an internal user no top-up', async () => {
    const page = await render({ api: api(), summary: summary({ plan: 'internal' }), refresh: () => {} })
    expect(page.textContent).toContain('内部账号')
    expect(page.textContent).not.toContain('充值 $5')
  })

  it('points to an admin while online top-up is not set up', async () => {
    const page = await render({ api: api(), summary: summary({ topUpEnabled: false }), refresh: () => {} })
    expect(page.textContent).toContain('联系管理员充值')
  })

  it('says so when the deployment does not bill', async () => {
    const page = await render(null)
    expect(page.textContent).toContain('没有开启计费')
  })
})
