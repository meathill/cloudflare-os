// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HelpGuideModal from './HelpGuideModal'

// 「模型价格」页签挂载时经 useAuthenticatedApi() 取数；这里给一个没有 AuthProvider 的最小桩。
// 桩对象必须稳定（useEffect 以它为依赖），所以放在 vi.hoisted 里只建一次。
const { api } = vi.hoisted(() => ({
  api: { getModelPricing: () => Promise.resolve([]) },
}))

vi.mock('../../AuthContext', () => ({
  useAuthenticatedApi: () => ({ authenticatedApi: api }),
}))

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('HelpGuideModal', () => {
  let root: Root | undefined
  const container = document.createElement('div')

  afterEach(() => {
    act(() => root?.unmount())
    container.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders business scenarios by default on first tab', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn<(open: boolean) => void>()

    await act(async () => {
      root!.render(<HelpGuideModal open={true} onOpenChange={onOpenChange} />)
    })

    // Verify main modal title and writer scenario items
    expect(document.body.textContent).toContain('帮助信息')
    expect(document.body.textContent).toContain('场景一：从零立项一部新剧本')
    expect(document.body.textContent).toContain('场景二：对标爆款剧本，拆解结构并换皮二创（模式一：A + C）')
    expect(document.body.textContent).toContain('场景三：纯原创构思，漫剧节奏大纲与多人精修（模式二：B + C）')
    expect(document.body.textContent).toContain('哈利波特大战葫芦娃')
  })

  it('switches to glossary tab and displays writer-friendly definitions', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn<(open: boolean) => void>()

    await act(async () => {
      root!.render(<HelpGuideModal open={true} onOpenChange={onOpenChange} />)
    })

    // Find tab buttons
    const buttons = Array.from(document.body.querySelectorAll('button'))
    const glossaryTab = buttons.find((btn) => btn.textContent?.includes('核心概念人话速查'))
    expect(glossaryTab).toBeDefined()

    // Click glossary tab
    await act(async () => {
      glossaryTab?.click()
    })

    // Verify writer-friendly terminology
    expect(document.body.textContent).toContain('工作区（剧本工作区 / 项目工作目录）')
    expect(document.body.textContent).toContain('蓝图（剧作蓝图 / 工业流模板）')
    expect(document.body.textContent).toContain('成果（最终剧本成果 / 交付件）')
    expect(document.body.textContent).toContain('一部剧 = 一个工作区')
    expect(document.body.textContent).toContain('彻底定稿打包的作品')
  })

  it('calls onOpenChange(false) when close button is clicked', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn<(open: boolean) => void>()

    await act(async () => {
      root!.render(<HelpGuideModal open={true} onOpenChange={onOpenChange} />)
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const closeBtn = buttons.find((btn) => btn.textContent?.includes('我知道了'))
    expect(closeBtn).toBeDefined()

    await act(async () => {
      closeBtn?.click()
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('opens the pricing tab and mounts the pricing table only then', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn<(open: boolean) => void>()

    await act(async () => {
      root!.render(<HelpGuideModal open={true} onOpenChange={onOpenChange} />)
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const pricingTab = buttons.find((btn) => btn.textContent?.includes('模型价格'))
    expect(pricingTab).toBeDefined()
    // 未打开页签时不挂载、不取数。
    expect(document.body.textContent).not.toContain('暂无模型价格。')

    await act(async () => {
      pricingTab?.click()
    })

    // 桩接口返回空列表时展示空态。
    expect(document.body.textContent).toContain('暂无模型价格。')
    expect(document.body.textContent).not.toContain('场景一：从零立项一部新剧本')
  })

  it('renders version badge in modal footer', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn<(open: boolean) => void>()

    await act(async () => {
      root!.render(<HelpGuideModal open={true} onOpenChange={onOpenChange} />)
    })

    expect(document.body.textContent).toContain('v1.3.0 (Build 2026-10-16 17:30)')
  })
})
