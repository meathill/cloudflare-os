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

  it('switches to drama research tab and imports summary into remake mode', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onOpenChange = vi.fn()

    await act(async () => {
      root!.render(<ScriptStudioModal open={true} onOpenChange={onOpenChange} />)
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const researchTab = buttons.find((btn) => btn.textContent?.includes('剧目研报 (全网搜索)'))
    expect(researchTab).toBeDefined()

    await act(async () => {
      researchTab?.click()
    })

    expect(document.body.textContent).toContain('剧目资料与口碑全网深度研报')

    // Quick fill and search
    const quickFillBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('填入示例剧名')
    )
    expect(quickFillBtn).toBeDefined()

    await act(async () => {
      quickFillBtn?.click()
    })

    const searchBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('检索全网研报')
    )
    expect(searchBtn).toBeDefined()

    await act(async () => {
      searchBtn?.click()
    })

    expect(document.body.textContent).toContain('核心剧情梗概')
    expect(document.body.textContent).toContain('全网/豆瓣口碑')

    // Click import to remake
    const importBtn = Array.from(document.body.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('一键导入到爆款拆解流 (A模块)')
    )
    expect(importBtn).toBeDefined()

    await act(async () => {
      importBtn?.click()
    })

    // Should switch back to remake mode with the imported summary
    expect(document.body.textContent).toContain('① 对标爆款剧本与新设定 (输入A)')
    const textarea = document.body.querySelector('textarea')
    expect(textarea?.value).toContain('全网深度调研简报')
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
