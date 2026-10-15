// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ScriptStudioModal from './ScriptStudioModal'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('ScriptStudioModal', () => {
  let root: Root | undefined
  const container = document.createElement('div')

  afterEach(() => {
    act(() => root?.unmount())
    container.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders remake mode (A + C) by default', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn()

    await act(async () => {
      root!.render(<ScriptStudioModal open={true} onOpenChange={onOpenChange} />)
    })

    expect(document.body.textContent).toContain('中文在线剧作工坊 · A/B/C 生产台')
    expect(document.body.textContent).toContain('爆款拆解重写流 (A + C)')
    expect(document.body.textContent).toContain('① 对标爆款剧本与新设定 (输入A)')
    expect(document.body.textContent).toContain('② 漫剧节奏分集生成 (产出C)')
  })

  it('switches to original manga workshop mode (B + C)', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn()

    await act(async () => {
      root!.render(<ScriptStudioModal open={true} onOpenChange={onOpenChange} />)
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const originalTab = buttons.find((btn) => btn.textContent?.includes('原创漫剧工坊流 (B + C)'))
    expect(originalTab).toBeDefined()

    await act(async () => {
      originalTab?.click()
    })

    expect(document.body.textContent).toContain('① 原创灵感与脑洞输入 (输入B)')
    expect(document.body.textContent).toContain('② 原创漫剧分集与正文 (产出C)')
    expect(document.body.textContent).toContain('执行模块B：故事核与世界观推演')
  })

  it('switches to skills center tab (C core)', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn()

    await act(async () => {
      root!.render(<ScriptStudioModal open={true} onOpenChange={onOpenChange} />)
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const skillsTab = buttons.find((btn) => btn.textContent?.includes('漫剧精调与质检 (C核心)'))
    expect(skillsTab).toBeDefined()

    await act(async () => {
      skillsTab?.click()
    })

    expect(document.body.textContent).toContain('漫剧工业 4 大卡点铁律与技能调度中心 (模块C)')
    expect(document.body.textContent).toContain('黄金前3秒原则')
    expect(document.body.textContent).toContain('45秒中段极性反转')
    expect(document.body.textContent).toContain('悬念断点 (Cliffhanger)')
  })

  it('calls onOpenChange(false) when close button is clicked', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn()

    await act(async () => {
      root!.render(<ScriptStudioModal open={true} onOpenChange={onOpenChange} />)
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const closeBtn = buttons.find((btn) => btn.textContent?.includes('关闭工作台'))
    expect(closeBtn).toBeDefined()

    await act(async () => {
      closeBtn?.click()
    })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
