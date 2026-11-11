// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createOpenWorkspaceError, OPEN_WORKSPACE_ERROR_CODES } from '@gadgets/workshop-shared/api'
import WorkspaceOpenErrorPage, {
  classifyWorkspaceOpenFailure,
  type WorkspaceOpenFailureKind,
} from './WorkspaceOpenErrorPage'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

vi.mock('./WorkshopControls', () => ({
  WorkshopButton: ({ children, onClick }: { children: ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}))

describe('WorkspaceOpenErrorPage', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = undefined
    container = undefined
  })

  async function render(kind: WorkspaceOpenFailureKind) {
    const onRetry = vi.fn<() => void>()
    const onGoToWorkspaces = vi.fn<() => void>()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root!.render(
      <WorkspaceOpenErrorPage
        kind={kind}
        onRetry={onRetry}
        onGoToWorkspaces={onGoToWorkspaces}
      />,
    ))
    return { container, onGoToWorkspaces, onRetry }
  }

  it('explains how to recover when access is denied without exposing workspace metadata', async () => {
    const { container: renderedContainer, onGoToWorkspaces, onRetry } = await render('access-denied')

    expect(renderedContainer.querySelector('h1')?.textContent).toBe("你无权访问此工作区")
    expect(renderedContainer.textContent).toContain('请联系工作区所有者授予访问权限，然后重试。')
    expect(document.activeElement).toBe(renderedContainer.querySelector('h1'))

    const buttons = [...renderedContainer.querySelectorAll('button')]
    expect(buttons.map(button => button.textContent)).toEqual(['前往工作区', '重试'])
    act(() => buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    act(() => buttons[1].dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onGoToWorkspaces).toHaveBeenCalledOnce()
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('gives a missing workspace a distinct, non-retryable state', async () => {
    const { container: renderedContainer } = await render('not-found')

    expect(renderedContainer.querySelector('h1')?.textContent).toBe('未找到工作区')
    expect(renderedContainer.textContent).toContain('链接可能有误，或工作区已被删除。')
    expect([...renderedContainer.querySelectorAll('button')].map(button => button.textContent))
      .toEqual(['前往工作区'])
  })

  it('lets a refused redeemer retry once the owner adds them directly', async () => {
    const { container: renderedContainer } = await render('share-links-disabled')

    expect(renderedContainer.querySelector('h1')?.textContent)
      .toBe('此工作区已关闭分享链接')
    expect(renderedContainer.textContent)
      .toContain('请联系工作区所有者直接添加你，然后重试。')
    // Retrying reopens without the consumed share key, so it succeeds after a direct add.
    expect([...renderedContainer.querySelectorAll('button')].map(button => button.textContent))
      .toEqual(['前往工作区', '重试'])
  })

  it('keeps unexpected failures retryable', async () => {
    const { container: renderedContainer } = await render('unexpected')

    expect(renderedContainer.querySelector('h1')?.textContent).toBe("无法加载此工作区")
    expect(renderedContainer.textContent).toContain('请重试。如果问题仍然存在，请返回工作区列表。')
    expect([...renderedContainer.querySelectorAll('button')].map(button => button.textContent))
      .toEqual(['前往工作区', '重试'])
  })

  it('classifies stable open error codes without treating unexpected errors as expected', () => {
    expect(classifyWorkspaceOpenFailure(
      createOpenWorkspaceError(OPEN_WORKSPACE_ERROR_CODES.workspaceAccessDenied),
    )).toBe('access-denied')
    expect(classifyWorkspaceOpenFailure(
      createOpenWorkspaceError(OPEN_WORKSPACE_ERROR_CODES.workspaceNotFound),
    )).toBe('not-found')
    expect(classifyWorkspaceOpenFailure(
      createOpenWorkspaceError(OPEN_WORKSPACE_ERROR_CODES.shareLinksDisabled),
    )).toBe('share-links-disabled')
    expect(classifyWorkspaceOpenFailure(
      new Error(OPEN_WORKSPACE_ERROR_CODES.workspaceAccessDenied),
    )).toBe('unexpected')
    expect(classifyWorkspaceOpenFailure(new Error('storage unavailable'))).toBe('unexpected')
  })
})
