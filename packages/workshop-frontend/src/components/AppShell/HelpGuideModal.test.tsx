// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HelpGuideModal from './HelpGuideModal'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

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
    const onOpenChange = vi.fn()

    await act(async () => {
      root!.render(<HelpGuideModal open={true} onOpenChange={onOpenChange} />)
    })

    // Verify main modal title and writer scenario items
    expect(document.body.textContent).toContain('编剧创作指南与实战手册')
    expect(document.body.textContent).toContain('场景一：从零立项一部新剧本')
    expect(document.body.textContent).toContain('场景二：套用成熟的戏份与类型流')
    expect(document.body.textContent).toContain('哈利波特爱上林黛玉的武打戏')
    expect(document.body.textContent).toContain('哈利波特大战葫芦娃')
  })

  it('switches to glossary tab and displays writer-friendly definitions', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn()

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
    expect(document.body.textContent).toContain('Workspace（剧本工作区 / 项目工作目录）')
    expect(document.body.textContent).toContain('Blueprint（剧作蓝图 / 工业流模版）')
    expect(document.body.textContent).toContain('Output（最终剧本成果 / 交付件）')
    expect(document.body.textContent).toContain('一部剧 = 一个工作区')
    expect(document.body.textContent).toContain('彻底定稿打包的作品')
  })

  it('calls onOpenChange(false) when close button is clicked', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn()

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
})
