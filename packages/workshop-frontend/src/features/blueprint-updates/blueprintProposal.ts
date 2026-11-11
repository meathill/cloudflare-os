import type { AiChatMessage, BlueprintMerge } from '@gadgets/workshop-shared/api'
import { titleOf } from './blueprintChoices'

/**
 * The blueprint proposals this message records that a person applied (see
 * GadgetClient.applyBlueprint()), which the transcript shows as a notice. The agent's
 * `createGadget` records an entry too, on a message of its own: that one is part of a gadget's
 * creation, which the transcript already shows as a card.
 */
export const appliedBlueprintMerges = (message: AiChatMessage): BlueprintMerge[] =>
  message.type === 'changes' && message.author.type === 'user' ? message.blueprintMerges ?? [] : []

/**
 * What the notice of a proposal says, generated from its record alone. It describes the proposal
 * as it was made, in words that stay true as the chat goes on: whether a conflict it reports
 * has since been resolved is for the accept-time check to say (see mergeConflicts.ts).
 *
 * The notice is read by people who are not developers, so everything above `details` avoids
 * version-control terms. `details` is the technical account, shown only on request.
 */
export type BlueprintProposalDescription = {
  /** The blueprint and the version of it proposed. */
  heading: string
  /** What accepting the proposal does to the gadget, unless `customizations` says it. */
  summary?: string
  /**
   * For a proposal that combines the update with the gadget's own changes: that it does, and
   * who makes sure the two are compatible. Shown as a warning, since it is the case that needs
   * the user's attention.
   */
  customizations?: string
  /** That the update may have undone the user's own work unreported, if it may have. */
  warning?: { title: string; description: string }
  /** What the user is expected to do about it, while it is still proposed. */
  nextStep?: string
  /** The connections the version needs that the gadget had none set up for. */
  missingBindings: { name: string; title: string; description: string }[]
  /** What to do about those connections, where nobody is doing it already and it is not too late. */
  missingBindingsHint?: string
  details: BlueprintProposalDetails
}

/** The technical account of a proposal, for the notice's "Advanced details". */
export type BlueprintProposalDetails = {
  /** How the files were combined. */
  method: string
  /** Short ids of the commits involved. */
  baseCommit?: string
  releaseCommit: string
  /** The files the merge left conflicts in, all of them. */
  conflictPaths: readonly string[]
  /** Explanations of what the facts above imply. */
  notes: string[]
}

const shortCommit = (commitId: string) => commitId.slice(0, 7)

const METHODS: Record<BlueprintMerge['kind'], string> = {
  follow: '仅跟随：记录版本，不更改文件',
  fastForward: '快进：使用该版本替换文件',
  merge: '三方合并',
}

const CONFLICTS_NOTE =
  '冲突文件在双方存在分歧的位置包含冲突标记，接受前需要解决。一方删除而另一方修改的文件没有标记，保留的是修改后的版本。'

const UNVERIFIED_BASE_NOTE =
  '应用与蓝图没有共同历史，因此合并基准只能根据应用原始版本猜测。猜测结果中包含的应用更改可能被误认为蓝图删除的内容并被撤销，且不会报告冲突。'

/**
 * Describes a proposal to merge a blueprint's release into a gadget. Its `kind` says what it does
 * to the gadget's files: a "follow" changes none, and a "merge" always has something to review,
 * a changed file or a conflict (see BlueprintMerge.kind). `reviewed` is whether an agent is
 * taking part in the chat, which for a merge means it was asked to review the result (see
 * GadgetClient.applyBlueprint()). `decided` is whether the proposal has been accepted or
 * discarded, after which the notice stays as a record and says nothing about what is still to do.
 */
export const describeBlueprintProposal = (
  merge: BlueprintMerge,
  { reviewed, decided }: { reviewed: boolean; decided: boolean },
): BlueprintProposalDescription => {
  const combined = merge.kind === 'merge'
  const changesFiles = merge.kind !== 'follow'
  const conflicted = merge.conflictPaths.length > 0

  const summary = merge.kind === 'follow'
    ? '此应用已包含此版本的全部内容，因此不会更改文件。接受后，应用今后将从此蓝图获取更新。'
    : '此应用自上次更新以来没有更改，因此将直接更新到此版本。'

  const missingBindings = Object.entries(merge.missingBindings ?? {})
    .map(([name, { title, description }]) => ({ name, title: title || name, description }))
    .toSorted((a, b) => a.name.localeCompare(b.name))

  const notes = [
    ...(conflicted ? [CONFLICTS_NOTE] : []),
    ...(merge.unverifiedBase ? [UNVERIFIED_BASE_NOTE] : []),
  ]

  return {
    heading: `${titleOf(merge.title)}，版本 ${merge.version}`,
    ...(combined ? {
      customizations:
        '你对应用所做的自定义超出了原蓝图的内容。' + (
          reviewed
            ? decided
              ? '已请智能体确认你的自定义内容与新版本兼容。'
              : '智能体正在确认你的自定义内容与新版本兼容。'
            : conflicted
              ? '部分自定义内容与新版本冲突，目前没有智能体检查。' + (decided ? '' : '请在接受前通过此对话请求解决。')
              : '目前没有智能体检查你的自定义内容是否与新版本兼容。'
        ),
    } : { summary }),
    // A guessed base can only have misled a merge that changed something.
    ...(merge.unverifiedBase && changesFiles ? {
      warning: {
        title: '你的部分更改可能已被撤销',
        description:
          '应用的历史与蓝图不相连，因此更新可能在未提示的情况下撤销了应用中的更改。' +
          (decided ? '' : '请在接受前仔细检查结果。'),
      },
    } : {}),
    ...(decided ? {} : {
      nextStep: changesFiles
        ? '接受之前不会更改任何内容。请先在预览中试用此版本。'
        : '接受之前不会更改任何内容。',
    }),
    missingBindings,
    // The agent that reviews a merge is asked to set these up. No other proposal starts one.
    ...(missingBindings.length > 0 && !(combined && reviewed) && !decided
      ? { missingBindingsHint: '请在此对话中请求配置。' }
      : {}),
    details: {
      method: METHODS[merge.kind],
      ...(merge.baseCommit === undefined ? {} : { baseCommit: shortCommit(merge.baseCommit) }),
      releaseCommit: shortCommit(merge.commitId),
      conflictPaths: merge.conflictPaths,
      notes,
    },
  }
}
