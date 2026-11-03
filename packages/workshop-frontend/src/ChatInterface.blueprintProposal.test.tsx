// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type {
  AiChatMessage, AiChatMetadata, AiChatSubscriber, BlueprintMerge, FileAtCommit,
  MergeChangesResult, Overseer,
} from '@gadgets/workshop-shared/api'
import { requireTextContent, type CodeContent } from '@gadgets/workshop-shared/code-change'

// Covers a merge as the chat shows it: a blueprint proposal's notice in the transcript, accept
// and discard for a proposal that the chat's metadata does not announce, the check for
// unresolved conflicts that stands in front of accepting, and an update from mainline's row.

vi.stubGlobal('ResizeObserver', class {
  observe() {}
  disconnect() {}
})
// jsdom lays nothing out; the message list scrolls itself to the bottom on every render.
Element.prototype.scrollTo = () => {}

vi.mock('@cloudflare/kumo', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@cloudflare/kumo')
  const Pass = ({ children }: { children?: React.ReactNode }) => children ?? null
  const Null = () => null
  const parts = new Proxy(Pass, {
    get: (_target, property) => property === 'Root' ? Null : Pass,
  })
  // A dialog shows what is in it while it is open, without the portal and focus handling.
  const Dialog = new Proxy(Pass, {
    get: (_target, property) => property === 'Root'
      ? ({ open, children }: { open?: boolean, children?: React.ReactNode }) => open ? children : null
      : property === 'Close' ? Null : Pass,
  })
  const toasts = { add: vi.fn<(options: unknown) => void>() }
  return {
    ...actual,
    Dialog,
    DropdownMenu: parts,
    Popover: parts,
    Tooltip: Pass,
    useKumoToastManager: () => toasts,
  }
})

const authState = vi.hoisted(() => ({ currentUser: null as { type: 'user'; id: string; name: string } | null }))

vi.mock('./AuthContext', () => {
  const context = {
    authenticatedApi: { listGatekeeperVendors: async () => [] },
    get currentUser() { return authState.currentUser },
  }
  return {
    useAuthenticatedApi: () => context,
    useOptionalAuthenticatedApi: () => null,
  }
})

import { makeOverseer, makeTestRoot } from './action-test-harness'
import ChatInterface from './ChatInterface'

const testRoot = makeTestRoot()

afterEach(() => {
  testRoot.cleanup()
  authState.currentUser = null
  vi.restoreAllMocks()
})

const CHAT_ID = 1
const GADGET_ID = 4

const USER = { type: 'user', id: 'dev', name: 'Dev' } as const

const CONFLICTED = [
  '<<<<<<< this gadget',
  'const days = 3',
  '||||||| base',
  'const days = 1',
  '=======',
  'const days = 7',
  '>>>>>>> blueprint',
  '',
].join('\n')

const merge = (over: Partial<BlueprintMerge> = {}): BlueprintMerge => ({
  gadgetId: GADGET_ID,
  blueprintId: 'blueprint',
  title: 'Trip planner',
  version: 3,
  commitId: 'release',
  kind: 'merge',
  baseCommit: 'base',
  conflictPaths: [],
  ...over,
})

const changes = (
  sequence: number, over: Partial<Extract<AiChatMessage, { type: 'changes' }>>,
): AiChatMessage => ({
  chatId: CHAT_ID,
  sequence,
  timestamp: new Date(1700000000000 + sequence),
  author: USER,
  type: 'changes',
  ...over,
})

const chatMetadata = (over: Partial<AiChatMetadata> = {}): AiChatMetadata => ({
  id: CHAT_ID,
  title: 'Update from blueprint: Trip planner',
  started: new Date(1700000000000),
  lastActive: new Date(1700000000000),
  ...over,
})

// Renders the chat as it is right after `applyBlueprint` made it: its metadata, and a history
// that is the proposal alone. `content` is what the code view holds of the chat's files: only
// those the chat touched since its merge, the rest being read from `commits`.
async function renderProposalChat(options: {
  metadata?: AiChatMetadata
  history: AiChatMessage[]
  content?: () => CodeContent | undefined
  // Whether the code view holds edits that the server has yet to acknowledge.
  hasLocalEdits?: () => boolean
  // Files by commit, for what the chat has not touched. Commit ids are page-wide: the code
  // view's store caches them.
  commits?: Record<string, Record<string, string>>
  mergeOutcome?: MergeChangesResult
  updateChatFromMainline?: () => Promise<{ conflictPaths: string[] }>
}) {
  const server = makeOverseer()
  const mergeChanges = vi.fn<(chatId: number) => Promise<MergeChangesResult>>(
    async () => options.mergeOutcome ?? { outcome: 'merged' })
  const revertChanges = vi.fn<(chatId: number, revertFrom: number) => Promise<void>>(
    async () => {})
  let subscriber: AiChatSubscriber | undefined
  Object.assign(server.overseer as object, {
    getChatMessage: async () => null,
    getChatHistory: async () => ({ messages: options.history }),
    listChats: async () => [options.metadata ?? chatMetadata()],
    listModels: async () => [],
    onRpcBroken: () => {},
    subscribeToChat: (next: AiChatSubscriber) => {
      subscriber = next
      return { [Symbol.dispose]: () => {} }
    },
    viewChat: () => ({ [Symbol.dispose]: () => {} }),
    readFilesAtCommit: async (commitId: string, paths: string[]) =>
      paths.map((path): [string, FileAtCommit] => {
        const text = options.commits?.[commitId]?.[path]
        return [path, text === undefined ? { kind: 'absent' } : { kind: 'text', text }]
      }),
    mergeChanges,
    revertChanges,
    updateChatFromMainline: options.updateChatFromMainline,
  })

  await testRoot.render(
    <ChatInterface
      workspaceId="workspace"
      overseer={server.overseer as RpcStub<Overseer>}
      selectedChatId={CHAT_ID}
      onNavigateToChat={() => {}}
      chatContent={options.content && {
        chatId: CHAT_ID,
        read: () => {
          const content = options.content!()
          return content && ((gadgetId, path) => requireTextContent(content.get(gadgetId)?.get(path)))
        },
        hasLocalEdits: options.hasLocalEdits ?? (() => false),
      }}
      pendingConsoleLogCount={0}
      consoleLogPreview=""
      consoleLogSeverity="info"
      onConsumeConsoleLogs={() => ''}
      onDiscardConsoleLogs={() => {}}
      onOpenGadget={() => {}}
      outputOfWorkpiece={() => undefined}
    />,
  )
  await server.resolveSubscription()
  await server.resolvePendingQuery({ entries: [] })

  return {
    mergeChanges,
    revertChanges,
    emitMessage(message: AiChatMessage) {
      act(() => subscriber!.message(message))
    },
  }
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === label)

async function click(label: string) {
  const target = button(label)
  if (!target) throw new Error(`No "${label}" button rendered`)
  await act(async () => { target.click() })
}

const text = () => document.body.textContent ?? ''

// The proposal as `applyBlueprint` records it: the merge is a commit, which the message's pin
// declaration re-roots the gadget at, and the message carries no change.
const proposal = (over: Partial<BlueprintMerge> = {}, baseCommit = 'merge') => changes(0, {
  blueprintMerges: [merge(over)],
  pins: [{ gadgetId: GADGET_ID, baseCommit, mergedCommit: 'head' }],
})

it('将自己的编辑显示为你，并保留其他用户的名称', async () => {
  authState.currentUser = USER
  await renderProposalChat({
    history: [
      changes(0, { change: { [GADGET_ID]: [['a.ts', { set: 'one' }]] } }),
      changes(1, {
        author: { type: 'user', id: 'other', name: 'You' },
        change: { [GADGET_ID]: [['b.ts', { set: 'two' }]] },
      }),
    ],
  })

  expect(text()).toContain('你 保存了编辑')
  expect(text()).toContain('You 保存了编辑')
})

describe('blueprint proposal notice', () => {
  it('describes a merge from its record, in place of a saved-edits row', async () => {
    await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [proposal({ conflictPaths: ['client.js'] })],
    })

    expect(text()).toContain('Trip planner，版本 3')
    expect(text()).toContain('你对应用所做的自定义')
    // No agent is taking part, so the clash is left to the user.
    expect(text()).toContain('请在接受前通过此对话请求解决')
    expect(text()).toContain('请先在预览中试用此版本。')
    expect(text()).not.toContain('保存了编辑')
    expect(text()).not.toContain('client.js')

    await click('高级详情')
    expect(text()).toContain('三方合并')
    expect(text()).toContain('client.js')
  })

  it('says the agent is checking a merge once one is taking part', async () => {
    await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [
        proposal({ conflictPaths: ['client.js'] }),
        {
          chatId: CHAT_ID, sequence: 1, timestamp: new Date(1700000000001),
          author: { type: 'agent', id: 'model', name: 'Model' },
          type: 'message', message: 'Resolved the conflict in client.js.',
        },
      ],
    })

    expect(text()).toContain('智能体正在确认你的自定义内容与新版本兼容')
    expect(text()).not.toContain('请在接受前通过此对话请求解决')
  })

  // What the proposal does is its kind, since no message of it carries a change.
  it('tells each kind apart with no change on the message', async () => {
    await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [proposal({ kind: 'fastForward' })],
    })
    expect(text()).toContain('将直接更新到此版本')
    expect(text()).toContain('请先在预览中试用此版本。')
    testRoot.cleanup()

    await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [proposal({ kind: 'follow' })],
    })
    expect(text()).toContain('不会更改文件')
    expect(text()).not.toContain('请先在预览中试用此版本。')
  })

  // The release deleted a file the gadget changed. The gadget's version is kept, so no file
  // changes, but whether it should stay is still to be decided.
  it('treats a merge that changes no file as one to review', async () => {
    await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [proposal({ conflictPaths: ['legacy.js'] })],
    })

    expect(text()).toContain('你对应用所做的自定义')
    expect(text()).not.toContain('不会更改文件')
  })

  it('keeps the notice once the proposal is decided, marked with which way', async () => {
    const chat = await renderProposalChat({
      history: [changes(0, { blueprintMerges: [merge({ kind: 'follow', baseCommit: undefined })] })],
    })
    expect(text()).toContain('接受之前不会更改任何内容。')

    chat.emitMessage({
      chatId: CHAT_ID, sequence: 1, timestamp: new Date(), author: USER, type: 'revert', revertFrom: 0,
    })

    expect(text()).toContain('Trip planner，版本 3')
    expect(text()).toContain('已放弃')
    expect(text()).toContain('今后将从此蓝图获取更新')
    expect(text()).not.toContain('接受之前不会更改任何内容。')
  })
})

describe('accepting a proposal that the chat’s metadata does not announce', () => {
  // The release is already in the gadget's history and no file changes, so the chat pins
  // nothing and proposes changes to no workpiece.
  const follow = changes(0, { blueprintMerges: [merge({ kind: 'follow', baseCommit: undefined })] })

  it('offers accept and discard while the proposal is still to be decided', async () => {
    const chat = await renderProposalChat({ history: [follow] })

    expect(text()).toContain('待处理更改')
    await click('接受更改')
    expect(chat.mergeChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID)
  })

  it('stops offering them once the proposal is accepted', async () => {
    const chat = await renderProposalChat({ history: [follow] })

    chat.emitMessage({
      chatId: CHAT_ID, sequence: 1, timestamp: new Date(), author: USER,
      type: 'merge', mergeThrough: 0, commits: [],
    })

    expect(button('接受更改')).toBeUndefined()
    expect(text()).toContain('Trip planner，版本 3')
    expect(text()).toContain('已接受')
  })
})

describe('accepting changes with unresolved merge conflicts', () => {
  const contentOf = (clientJs: string): CodeContent =>
    new Map([[GADGET_ID, new Map([['client.js', clientJs]])]])
  // The chat as the merge left it: pinned at the merge commit, with the markers in it.
  const pinnedAt = (baseCommit: string) => chatMetadata({
    proposedChangeWorkpieces: [GADGET_ID],
    codeBase: {
      pins: [{ gadgetId: GADGET_ID, baseCommit, mergedCommit: 'head' }],
      generation: 0,
      revision: 0,
    },
  })
  const conflictedAt = (baseCommit: string) =>
    proposal({ conflictPaths: ['client.js'] }, baseCommit)

  it('holds the accept while a conflicted file still has markers, and lets it through after', async () => {
    let content = contentOf(CONFLICTED)
    const chat = await renderProposalChat({
      metadata: pinnedAt('merge-edited'),
      history: [conflictedAt('merge-edited')],
      content: () => content,
    })

    await click('接受更改')
    expect(chat.mergeChanges).not.toHaveBeenCalled()
    expect(text()).toContain('此草稿仍有合并冲突')
    expect(text()).toContain('行 1')

    await click('继续解决')
    expect(text()).not.toContain('此草稿仍有合并冲突')
    expect(chat.mergeChanges).not.toHaveBeenCalled()

    content = contentOf('const days = 7\n')
    await click('接受更改')
    expect(text()).not.toContain('此草稿仍有合并冲突')
    expect(chat.mergeChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID)
  })

  // The merge is a commit, so its markers are in the chat's files without the chat's content
  // ever having held them.
  it('finds the markers in a conflicted file nobody has edited since the merge', async () => {
    const chat = await renderProposalChat({
      metadata: pinnedAt('merge-untouched'),
      history: [conflictedAt('merge-untouched')],
      content: () => new Map([[GADGET_ID, new Map()]]),
      commits: { 'merge-untouched': { 'client.js': CONFLICTED } },
    })

    await click('接受更改')
    expect(chat.mergeChanges).not.toHaveBeenCalled()
    expect(text()).toContain('此草稿仍有合并冲突')
    expect(text()).toContain('行 1')
  })

  it('finds none in a conflicted file resolved at the commit the chat is pinned at', async () => {
    const chat = await renderProposalChat({
      metadata: pinnedAt('merge-resolved'),
      history: [conflictedAt('merge-resolved')],
      content: () => new Map([[GADGET_ID, new Map()]]),
      commits: { 'merge-resolved': { 'client.js': 'const days = 7\n' } },
    })

    await click('接受更改')
    expect(text()).not.toContain('此草稿仍有合并冲突')
    expect(chat.mergeChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID)
  })

  it('accepts the markers when the user says to', async () => {
    const chat = await renderProposalChat({
      metadata: pinnedAt('merge-anyway'),
      history: [conflictedAt('merge-anyway')],
      content: () => contentOf(CONFLICTED),
    })

    await click('接受更改')
    await click('仍然接受')
    expect(chat.mergeChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID)
    expect(text()).not.toContain('此草稿仍有合并冲突')
  })

  it('checks the files of a mainline merge too', async () => {
    const chat = await renderProposalChat({
      metadata: pinnedAt('mainline-merge'),
      history: [
        changes(0, {
          mainlineMerge: {
            conflictPaths: ['PLANNER/client.js'],
            gadgets: [{
              gadgetId: GADGET_ID, baseCommit: 'base', chatCommit: 'before',
              conflictPaths: ['client.js'],
            }],
          },
          pins: [{ gadgetId: GADGET_ID, baseCommit: 'mainline-merge', mergedCommit: 'head' }],
        }),
      ],
      content: () => new Map([[GADGET_ID, new Map()]]),
      commits: { 'mainline-merge': { 'client.js': CONFLICTED } },
    })

    await click('接受更改')
    expect(chat.mergeChanges).not.toHaveBeenCalled()
    expect(text()).toContain('此草稿仍有合并冲突')
  })

  // A mainline merge recorded before merges were commits wrote its markers as a change.
  it('checks the files of a mainline merge recorded as a change', async () => {
    const chat = await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [
        changes(0, {
          mainlineMerge: { conflictPaths: ['PLANNER/client.js'] },
          change: { [GADGET_ID]: [['client.js', { set: CONFLICTED }]] },
        }),
      ],
      content: () => contentOf(CONFLICTED),
    })

    await click('接受更改')
    expect(chat.mergeChanges).not.toHaveBeenCalled()
    expect(text()).toContain('此草稿仍有合并冲突')
  })

  // The server merges what it has been sent. An edit still on its way there may be the one
  // that removed the last marker, which the content on screen already shows as gone.
  it('waits for edits that the server has yet to receive', async () => {
    let unsent = true
    const chat = await renderProposalChat({
      metadata: pinnedAt('merge-unsent'),
      history: [conflictedAt('merge-unsent')],
      content: () => contentOf('const days = 7\n'),
      hasLocalEdits: () => unsent,
    })

    await click('接受更改')
    expect(chat.mergeChanges).not.toHaveBeenCalled()

    unsent = false
    await click('接受更改')
    expect(chat.mergeChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID)
  })

  // Typing through an accept is ordinarily fine: the edits land after it. Only a chat with
  // conflicts to check has a reason to wait for them.
  it('does not wait for unsent edits in a chat with no conflicts listed', async () => {
    const chat = await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [changes(0, {
        pins: [{ gadgetId: GADGET_ID, baseCommit: 'head' }],
        change: { [GADGET_ID]: [['client.js', { set: 'const days = 7\n' }]] },
      })],
      content: () => contentOf('const days = 7\n'),
      hasLocalEdits: () => true,
    })

    await click('接受更改')
    expect(chat.mergeChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID)
  })

  // The check is the client's own, so a chat whose content has yet to load is not held up.
  it('accepts unchecked while the chat’s content has not loaded', async () => {
    const chat = await renderProposalChat({
      metadata: pinnedAt('merge-unloaded'),
      history: [conflictedAt('merge-unloaded')],
      content: () => undefined,
    })

    await click('接受更改')
    expect(chat.mergeChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID)
  })
})

describe('an update from mainline', () => {
  const update = (gadgets: boolean) => changes(0, {
    mainlineMerge: {
      conflictPaths: [],
      ...(gadgets
        ? {
            gadgets: [
              { gadgetId: GADGET_ID, baseCommit: 'base', chatCommit: 'before', conflictPaths: [] },
            ],
          }
        : {}),
    },
    pins: [{ gadgetId: GADGET_ID, baseCommit: 'merge', mergedCommit: 'head' }],
  })
  const discardButton = () =>
    document.querySelector<HTMLButtonElement>('button[aria-label^="放弃此次更新"]')

  // The update records where the pins were before it, so a revert can put them back.
  it('can be discarded', async () => {
    const chat = await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [update(true)],
    })

    expect(text()).toContain("将应用的最新更改引入了此草稿")
    const discard = discardButton()
    expect(discard?.disabled).toBe(false)
    await act(async () => { discard!.click() })
    expect(chat.revertChanges).toHaveBeenCalledExactlyOnceWith(CHAT_ID, 0)
  })

  it('cannot be discarded when recorded before merges were commits', async () => {
    await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [update(false)],
    })

    expect(discardButton()).toBeNull()
    const refused =
      document.querySelector<HTMLButtonElement>(`button[aria-label^="无法放弃此更新"]`)
    expect(refused?.disabled).toBe(true)
  })

  // The server refuses an update that needs a file too large to merge, and says which.
  it('shows why the server refused it', async () => {
    const refusal =
      'client.js is too large to merge. Make it smaller, or undo this chat’s changes to it.'
    await renderProposalChat({
      metadata: chatMetadata({ proposedChangeWorkpieces: [GADGET_ID] }),
      history: [changes(0, {
        pins: [{ gadgetId: GADGET_ID, baseCommit: 'old-head' }],
        change: { [GADGET_ID]: [['client.js', { set: 'const days = 7\n' }]] },
      })],
      mergeOutcome: { outcome: 'stale' },
      updateChatFromMainline: async () => { throw new Error(refusal) },
    })
    const { useKumoToastManager } = await import('@cloudflare/kumo')
    const toasts = useKumoToastManager()

    await click('接受更改')
    await click('引入最新更改')
    expect(toasts.add).toHaveBeenCalledWith({ title: refusal, variant: 'error' })
  })
})
