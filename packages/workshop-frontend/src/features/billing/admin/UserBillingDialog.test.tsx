// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { BillingAdminClient } from '@gadgets/workshop-shared/api'
import type { BillingAccountInfo, BillingUsageReport, BillingUsageRange } from '@gadgets/workshop-shared/billing'
import { UserBillingDialog } from './UserBillingDialog'
import type { PreBillingEstimate } from './legacyUsage'

vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: vi.fn<(toast: unknown) => void>() }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const RANGE: BillingUsageRange = { from: '2026-01-01', to: '2026-01-30' }

const EMPTY_REPORT: BillingUsageReport = {
  range: RANGE,
  totals: { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
    rawCostUsd: 0, chargedUsd: 0, platformCostUsd: 0 },
  byModel: [], byUser: [], bySource: [], byDay: [], ledger: [],
}

const account = (overrides: Partial<BillingAccountInfo> = {}): BillingAccountInfo => ({
  userKey: 'a@x.com', plan: 'standard', balanceUsd: 3, rawCostTotalUsd: 1, chargedTotalUsd: 2,
  markup: null, effectiveMarkup: 2, topUpTotalUsd: 10, createdAt: 1, updatedAt: 1,
  ...overrides,
})

const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve() })

const setInput = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label)

describe('UserBillingDialog', () => {
  let root: Root | undefined
  let host: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    vi.restoreAllMocks()
  })

  const render = async (acc: BillingAccountInfo, preBilling?: PreBillingEstimate) => {
    const setMarkup = vi.fn<(userKey: string, markup: number | null) => Promise<BillingAccountInfo>>(
      async (userKey, markup) => account({ userKey, markup, effectiveMarkup: markup ?? 2 }))
    const billing = {
      setMarkup,
      getUsageReport: async () => EMPTY_REPORT,
      listLedger: async () => [],
      listUsageEvents: async () => [],
      grant: async () => acc,
      [Symbol.dispose]: () => {},
    } as unknown as RpcStub<BillingAdminClient>
    const onUpdated = vi.fn<(account: BillingAccountInfo) => void>()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    act(() => root!.render(
      <UserBillingDialog account={acc} billing={billing} range={RANGE} preBilling={preBilling}
        onClose={() => {}} onUpdated={onUpdated} />,
    ))
    await flush()
    return { setMarkup, onUpdated }
  }

  it('cannot save a custom markup above 10', async () => {
    const { setMarkup } = await render(account())
    act(() => button('自定义')!.click())
    const input = document.querySelector<HTMLInputElement>('input[aria-label="自定义倍率"]')!
    act(() => setInput(input, '11'))
    const save = button('保存倍率') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    act(() => save.click())
    await flush()
    expect(setMarkup).not.toHaveBeenCalled()
  })

  it('saves a custom markup of 1.5', async () => {
    const { setMarkup, onUpdated } = await render(account())
    act(() => button('自定义')!.click())
    const input = document.querySelector<HTMLInputElement>('input[aria-label="自定义倍率"]')!
    act(() => setInput(input, '1.5'))
    const save = button('保存倍率') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    act(() => save.click())
    await flush()
    expect(setMarkup).toHaveBeenCalledWith('a@x.com', 1.5)
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ markup: 1.5 }))
  })

  it('saves the default choice as null markup', async () => {
    const { setMarkup } = await render(account({ markup: 1.5, effectiveMarkup: 1.5 }))
    act(() => button('默认')!.click())
    const save = button('保存倍率') as HTMLButtonElement
    expect(save.disabled).toBe(false)
    act(() => save.click())
    await flush()
    expect(setMarkup).toHaveBeenCalledWith('a@x.com', null)
  })

  it('shows the deployment default for a standard user without a personal markup', async () => {
    await render(account({ markup: null, effectiveMarkup: 2 }))
    expect(button('默认（2x）')).toBeDefined()
  })

  it('shows the pre-billing estimate card with the combined raw cost when provided', async () => {
    // 旧统计 $10 − 上线后对话 $3 = $7；加上累计原始成本 $1 → 合计约 $8。
    await render(account({ rawCostTotalUsd: 1 }), { legacyUsd: 10, postLaunchChatUsd: 3 })
    const text = document.body.textContent!
    expect(text).toContain('计费上线前（估算）')
    expect(text).toContain('$7.00')
    expect(text).toContain('旧统计 $10.00 − 上线后对话 $3.00')
    expect(text).toContain('合计原始成本约 $8.00')
  })

  it('hides the pre-billing estimate card when not provided', async () => {
    await render(account())
    expect(document.body.textContent).not.toContain('计费上线前')
  })
})
