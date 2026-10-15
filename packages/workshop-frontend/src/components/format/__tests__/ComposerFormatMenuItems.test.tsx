// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, type ReactElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ComposerFormatMenuItems from '../ComposerFormatMenuItems'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@cloudflare/kumo', () => {
  const DropdownMenu = Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Trigger: ({ render }: { render: ReactElement }) => render,
      Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
      Item: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
        <button type="button" onClick={onClick}>{children}</button>
      ),
    },
  )
  return {
    DropdownMenu,
  }
})

// Mock useOutputFormats to avoid RPC calls
vi.mock('../useOutputFormats', () => ({
  useOutputFormats: () => ({
    formats: [],
    creating: null,
    create: vi.fn(),
  }),
}))

describe('ComposerFormatMenuItems', () => {
  let root: Root | undefined
  const container = document.createElement('div')

  afterEach(() => {
    act(() => root?.unmount())
    container.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('renders Chinese Online scriptwriting directions header and items', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onSelect = vi.fn()
    const onSelectPrompt = vi.fn()

    await act(async () => {
      root!.render(
        <ComposerFormatMenuItems onSelect={onSelect} onSelectPrompt={onSelectPrompt} />,
      )
    })

    expect(document.body.textContent).toContain('选择剧作方向 (START WITH)')
    expect(document.body.textContent).toContain('爆款拆解与重构 (A+C)')
    expect(document.body.textContent).toContain('纯原创漫剧创作 (B+C)')
    expect(document.body.textContent).toContain('好莱坞分场剧本 (Script)')
    expect(document.body.textContent).toContain('故事节拍大纲 (Beat Sheet)')
    expect(document.body.textContent).toContain('人物小传与弧光设计')
  })

  it('triggers onSelectPrompt when remake direction (A+C) is clicked', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onSelect = vi.fn()
    const onSelectPrompt = vi.fn()

    await act(async () => {
      root!.render(
        <ComposerFormatMenuItems onSelect={onSelect} onSelectPrompt={onSelectPrompt} />,
      )
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const remakeItem = buttons.find((el) => el.textContent?.includes('爆款拆解与重构 (A+C)'))
    expect(remakeItem).toBeDefined()

    await act(async () => {
      remakeItem?.click()
    })

    expect(onSelectPrompt).toHaveBeenCalledTimes(1)
    const promptArg = onSelectPrompt.mock.calls[0][0]
    expect(promptArg).toContain('【爆款剧本拆解与二创')
    expect(promptArg).toContain('救猫咪15节拍')
  })

  it('triggers onSelectPrompt when original manga direction (B+C) is clicked', async () => {
    document.body.append(container)
    root = createRoot(container)
    const onSelect = vi.fn()
    const onSelectPrompt = vi.fn()

    await act(async () => {
      root!.render(
        <ComposerFormatMenuItems onSelect={onSelect} onSelectPrompt={onSelectPrompt} />,
      )
    })

    const buttons = Array.from(document.body.querySelectorAll('button'))
    const originalItem = buttons.find((el) => el.textContent?.includes('纯原创漫剧创作 (B+C)'))
    expect(originalItem).toBeDefined()

    await act(async () => {
      originalItem?.click()
    })

    expect(onSelectPrompt).toHaveBeenCalledTimes(1)
    const promptArg = onSelectPrompt.mock.calls[0][0]
    expect(promptArg).toContain('【纯原创漫剧创作工坊')
    expect(promptArg).toContain('黄金3秒')
  })
})
