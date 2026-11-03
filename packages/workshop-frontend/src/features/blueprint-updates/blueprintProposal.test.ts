import { describe, expect, it } from 'vitest'
import type { AiChatMessage, BlueprintMerge } from '@gadgets/workshop-shared/api'
import { appliedBlueprintMerges, describeBlueprintProposal } from './blueprintProposal'

const merge = (over: Partial<BlueprintMerge> = {}): BlueprintMerge => ({
  gadgetId: 1,
  blueprintId: 'blueprint',
  title: 'Trip planner',
  version: 3,
  commitId: 'release',
  kind: 'merge',
  baseCommit: 'base',
  conflictPaths: [],
  ...over,
})

const REVIEWED = { reviewed: true, decided: false }
const UNREVIEWED = { reviewed: false, decided: false }

// Words a reader who is not a developer should not meet outside the advanced details.
const JARGON = /merge|conflict|commit|binding|base\b/i

const plainText = (notice: ReturnType<typeof describeBlueprintProposal>) => [
  notice.summary, notice.customizations, notice.warning?.title, notice.warning?.description, notice.nextStep, notice.missingBindingsHint,
].filter(Boolean).join(' ')

describe('describeBlueprintProposal', () => {
  it('names the blueprint and the version proposed', () => {
    expect(describeBlueprintProposal(merge(), REVIEWED).heading).toBe('Trip planner，版本 3')
    expect(describeBlueprintProposal(merge({ title: '' }), REVIEWED).heading)
      .toBe('未命名蓝图，版本 3')
  })

  it('says a follow changes nothing, only where the gadget gets its updates', () => {
    const notice = describeBlueprintProposal(merge({ kind: 'follow' }), UNREVIEWED)
    expect(notice.summary).toContain('不会更改文件')
    expect(notice.summary).toContain('从此蓝图获取更新')
    expect(notice.nextStep).toBe('接受之前不会更改任何内容。')
    expect(notice.customizations).toBeUndefined()
  })

  it('says a fast-forward makes the gadget this version, and to try it first', () => {
    const notice = describeBlueprintProposal(merge({ kind: 'fastForward' }), UNREVIEWED)
    expect(notice.summary).toContain('将直接更新到此版本')
    expect(notice.nextStep).toBe('接受之前不会更改任何内容。请先在预览中试用此版本。')
    // Nothing is combined, so there is nothing for anyone to check.
    expect(notice.customizations).toBeUndefined()
  })

  it('says the agent is making sure the user’s customizations fit the new version', () => {
    const notice = describeBlueprintProposal(merge({ conflictPaths: ['client.js'] }), REVIEWED)
    expect(notice.customizations).toBe(
      '你对应用所做的自定义超出了原蓝图的内容。智能体正在确认你的自定义内容与新版本兼容。')
    expect(notice.summary).toBeUndefined()
  })

  it('says nobody is checking the customizations when no agent is taking part', () => {
    expect(describeBlueprintProposal(merge(), UNREVIEWED).customizations)
      .toContain('目前没有智能体检查你的自定义内容是否与新版本兼容')

    expect(describeBlueprintProposal(merge({ conflictPaths: ['client.js'] }), UNREVIEWED).customizations)
      .toContain('请在接受前通过此对话请求解决。')
  })

  // A release that only deleted a file the gadget changed leaves the gadget's files as they
  // were, but whether the file should stay is still to be decided.
  it('treats a merge that changes no file as one to review', () => {
    const notice = describeBlueprintProposal(merge({ conflictPaths: ['client.js'] }), REVIEWED)
    expect(notice.summary).toBeUndefined()
    expect(notice.customizations).toContain('智能体正在确认')
    expect(notice.details.method).toBe('三方合并')
    expect(notice.details.notes.join(' ')).toContain('一方删除而另一方修改')
  })

  it('keeps technical terms out of everything but the advanced details', () => {
    const missingBindings: BlueprintMerge['missingBindings'] = {
      WEATHER: {
        type: 'gatekeeper', title: 'Weather', description: '', gatekeeperName: 'weather',
        typeUrlPattern: 'https://weather.example/*',
      },
    }
    for (const kind of ['follow', 'fastForward', 'merge'] as const) {
      for (const options of [REVIEWED, UNREVIEWED].flatMap(pending =>
        [pending, { ...pending, decided: true }])) {
        const notice = describeBlueprintProposal(merge({
          kind, conflictPaths: ['client.js'], unverifiedBase: true, missingBindings,
        }), options)
        expect(plainText(notice)).not.toMatch(JARGON)
      }
    }
  })

  // The notice stays in the transcript as a record, where what was still to do no longer is.
  it('says nothing of what is still to do once the proposal is decided', () => {
    const missingBindings: BlueprintMerge['missingBindings'] = {
      WEATHER: {
        type: 'gatekeeper', title: 'Weather', description: '', gatekeeperName: 'weather',
        typeUrlPattern: 'https://weather.example/*',
      },
    }
    const decided = (over: Partial<BlueprintMerge>, reviewed: boolean) => describeBlueprintProposal(
      merge({ unverifiedBase: true, missingBindings, ...over }),
      { reviewed, decided: true })

    const reviewedNotice = decided({}, true)
    expect(reviewedNotice.customizations).toContain('已请智能体确认')
    expect(reviewedNotice.nextStep).toBeUndefined()
    expect(reviewedNotice.warning?.description).not.toContain('接受前')
    expect(reviewedNotice.missingBindings).toHaveLength(1)

    const unreviewed = decided({ conflictPaths: ['client.js'] }, false)
    expect(unreviewed.customizations).not.toContain('请在此对话')
    expect(unreviewed.missingBindingsHint).toBeUndefined()
  })

  it('gives the technical account in the details', () => {
    const conflictPaths = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => `${name}.js`)
    const { details } = describeBlueprintProposal(
      merge({ conflictPaths, baseCommit: '0123456789abcdef', commitId: 'fedcba9876543210' }),
      REVIEWED,
    )
    expect(details.method).toBe('三方合并')
    expect(details.baseCommit).toBe('0123456')
    expect(details.releaseCommit).toBe('fedcba9')
    expect(details.conflictPaths).toEqual(conflictPaths)
    expect(details.notes.join(' ')).toContain('一方删除而另一方修改')

    const follow =
      describeBlueprintProposal(merge({ kind: 'follow', baseCommit: undefined }), UNREVIEWED)
    expect(follow.details.baseCommit).toBeUndefined()
    expect(follow.details.notes).toEqual([])
  })

  it('warns that a merge over a guessed base may have undone the user’s work', () => {
    for (const kind of ['fastForward', 'merge'] as const) {
      const notice = describeBlueprintProposal(merge({ kind, unverifiedBase: true }), REVIEWED)
      expect(notice.warning?.title).toBe('你的部分更改可能已被撤销')
      expect(notice.details.notes.join(' ')).toContain('撤销，且不会报告冲突')
    }
  })

  it('does not warn of a guessed base where nothing changes', () => {
    const notice =
      describeBlueprintProposal(merge({ kind: 'follow', unverifiedBase: true }), UNREVIEWED)
    expect(notice.warning).toBeUndefined()
  })

  it('lists the connections the gadget lacks', () => {
    const missingBindings: BlueprintMerge['missingBindings'] = {
      WEATHER: {
        type: 'gatekeeper',
        title: 'Weather service',
        description: 'Forecasts for the trip.',
        gatekeeperName: 'weather',
        typeUrlPattern: 'https://weather.example/*',
      },
      CALENDAR: {
        type: 'gatekeeper',
        title: '',
        description: '',
        gatekeeperName: 'calendar',
        typeUrlPattern: 'https://calendar.example/*',
      },
    }
    const notice = describeBlueprintProposal(merge({ kind: 'fastForward', missingBindings }), UNREVIEWED)
    expect(notice.missingBindings).toEqual([
      { name: 'CALENDAR', title: 'CALENDAR', description: '' },
      { name: 'WEATHER', title: 'Weather service', description: 'Forecasts for the trip.' },
    ])
    // Nothing starts an agent for a fast-forward, so setting them up is left to be asked for.
    expect(notice.missingBindingsHint).toBe('请在此对话中请求配置。')

    // The agent that reviews a merge is asked to set them up itself.
    expect(describeBlueprintProposal(merge({ missingBindings }), REVIEWED).missingBindingsHint)
      .toBeUndefined()
    // Unless no agent is taking part.
    expect(describeBlueprintProposal(merge({ missingBindings }), UNREVIEWED).missingBindingsHint)
      .toBe('请在此对话中请求配置。')
    expect(describeBlueprintProposal(merge(), REVIEWED).missingBindings).toEqual([])
  })
})

const changes = (over: Partial<Extract<AiChatMessage, { type: 'changes' }>>): AiChatMessage => ({
  chatId: 1,
  sequence: 0,
  timestamp: new Date(0),
  author: { type: 'user', id: 'dev', name: 'Dev' },
  type: 'changes',
  ...over,
})

describe('appliedBlueprintMerges', () => {
  it('is the proposals a person applied', () => {
    expect(appliedBlueprintMerges(changes({ blueprintMerges: [merge()] }))).toEqual([merge()])
    expect(appliedBlueprintMerges(changes({}))).toEqual([])
  })

  // That entry belongs to the gadget's creation, which has a card of its own.
  it('leaves out the entry the agent records when it creates a gadget from a blueprint', () => {
    const created = changes({
      author: { type: 'agent', id: 'model', name: 'Model' },
      blueprintMerges: [merge({ kind: 'fastForward' })],
    })
    expect(appliedBlueprintMerges(created)).toEqual([])
  })
})
