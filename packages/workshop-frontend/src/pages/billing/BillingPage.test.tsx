// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BillingSummary } from '@gadgets/workshop-shared/billing'

const billingState = vi.hoisted(() => ({
  value: null as null | {
    api: { createCheckout: (tier: number) => Promise<{ url: string }>; listLedger: () => Promise<[]>; listUsage: () => Promise<[]> }
    summary: BillingSummary | null
    refresh: () => void
  },
}))

vi.mock('../../features/billing/BillingContext', () => ({ useBilling: () => billingState.value }))
vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
}))

import BillingPage from './BillingPage'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const summary = (overrides: Partial<BillingSummary>): BillingSummary => ({
  plan: 'standard', balanceUsd: 1.5, markup: 2, topUpTiersUsd: [5, 10], topUpEnabled: true, ...overrides,
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
    return container
  }

  type Checkout = (tier: number) => Promise<{ url: string }>
  const api = (createCheckout = vi.fn<Checkout>(async () => ({ url: 'https://checkout.stripe.com/c/1' }))) => ({
    createCheckout, listLedger: async () => [] as [], listUsage: async () => [] as [],
  })

  it('offers each top-up tier to a standard user and sends them to Stripe Checkout', async () => {
    const createCheckout = vi.fn<Checkout>(async () => ({ url: 'https://checkout.stripe.com/c/1' }))
    const assign = vi.fn<(url: string) => void>()
    vi.stubGlobal('location', { ...window.location, assign })
    const page = await render({ api: api(createCheckout), summary: summary({}), refresh: () => {} })
    expect(page.textContent).toContain('$1.50')
    expect(page.textContent).toContain('2 倍')
    const tier = [...page.querySelectorAll('button')].find((button) => button.textContent?.includes('$10'))!
    await act(async () => tier.click())
    expect(createCheckout).toHaveBeenCalledWith(10)
    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/c/1')
    vi.unstubAllGlobals()
  })

  it('shows an internal user no top-up', async () => {
    const page = await render({ api: api(), summary: summary({ plan: 'internal', markup: 1 }), refresh: () => {} })
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
