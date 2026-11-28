// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelPricing } from '@gadgets/workshop-shared/api'
import { ModelPricingTable } from './ModelPricingTable'

const { api } = vi.hoisted(() => ({
  api: { getModelPricing: vi.fn<() => Promise<ModelPricing[]>>() },
}))

vi.mock('../../AuthContext', () => ({
  useAuthenticatedApi: () => ({ authenticatedApi: api }),
}))

const PRICING: ModelPricing[] = [
  {
    provider: 'google',
    id: 'gemini-4-hydrogen',
    name: 'Gemini 4 Hydrogen',
    price: { input: 1.5, output: 7.5, cacheRead: 0.075, cacheWrite: 0 },
  },
  {
    provider: 'google',
    id: 'gemini-4-argon',
    name: 'Gemini 4 Argon',
    price: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 0 },
    nextPrice: {
      from: '2026-12-01',
      price: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 0 },
    },
  },
  {
    provider: 'openai',
    id: 'gpt-6.2-sol',
    name: 'GPT-6.2 Sol',
    price: {
      input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5,
      longContext: {
        inputTokensAbove: 272000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5,
      },
    },
  },
]

vi.mocked(api.getModelPricing).mockResolvedValue(PRICING)

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('ModelPricingTable', () => {
  let root: Root | undefined
  const container = document.createElement('div')

  afterEach(() => {
    act(() => root?.unmount())
    container.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function render() {
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(<ModelPricingTable />)
    })
  }

  it('groups models by provider and formats prices without trailing zeros', async () => {
    await render()

    expect(document.body.textContent).toContain('Google')
    expect(document.body.textContent).toContain('OpenAI')
    expect(document.body.textContent).toContain('Gemini 4 Hydrogen')
    expect(document.body.textContent).toContain('GPT-6.2 Sol')
    expect(document.body.textContent).toContain('单位：美元 / 百万 Tokens')
    expect(document.body.textContent).toContain('0.075')
    // 缓存写入为 0 时显示「—」。
    expect(document.body.textContent).toContain('—')
  })

  it('merges non-Gemini / non-OpenAI providers into one group', async () => {
    vi.mocked(api.getModelPricing).mockResolvedValueOnce([
      ...PRICING,
      {
        provider: 'cloudflare',
        id: '@cf/moonshotai/kimi-k2',
        name: 'Kimi K2',
        price: { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0 },
      },
      {
        provider: 'opencode-go',
        id: 'glm-5.3',
        name: 'GLM 5.3',
        price: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0 },
      },
    ])
    await render()

    const headings = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent)
    expect(headings).toEqual(['Google', 'OpenAI', '其他模型'])
    expect(document.body.textContent).toContain('Kimi K2')
    expect(document.body.textContent).toContain('GLM 5.3')
  })

  it('shows the long-context tier note under the model row', async () => {
    await render()

    expect(document.body.textContent).toContain(
      '单次输入超过 272K Tokens：输入 $4 · 输出 $15 · 缓存读取 $0.2')
  })

  it('shows the announced price change under the model row', async () => {
    await render()

    expect(document.body.textContent).toContain(
      '自 12 月 1 日起：输入 $4 · 输出 $20 · 缓存读取 $0.2')
  })

  it('links the official pricing pages in the footer', async () => {
    await render()

    expect(document.body.textContent).toContain(
      '以上为各模型官方参考单价；扣费 = 计费 Tokens × 单价。')
    const links = Array.from(document.body.querySelectorAll('a')).map((a) => a.href)
    expect(links).toContain('https://ai.google.dev/gemini-api/docs/pricing')
    expect(links).toContain('https://developers.openai.com/api/docs/pricing')
  })
})
