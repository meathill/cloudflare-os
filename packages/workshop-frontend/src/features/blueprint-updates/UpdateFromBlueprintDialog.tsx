import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Banner, Dialog, Loader, Radio, Select } from '@cloudflare/kumo'
import { X } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import type {
  AiChatAuthorInfo,
  BlueprintPublicInfo,
  GadgetClient,
  GadgetUpstream,
  Overseer,
  PublicApi,
} from '@gadgets/workshop-shared/api'
import { WorkshopButton, WorkshopIconButton, WorkshopInput } from '../../components/WorkshopControls'
import {
  fromModelSelectValue,
  getStoredSelectedModel,
  NO_AGENT_OPTION_VALUE,
  persistSelectedModel,
  toModelSelectValue,
} from '../../modelSelection'
import { useDialogSelectPortalContainer } from '../../useDialogSelectPortalContainer'
import { logRpcFailure } from '../../rpcErrors'
import { toBlueprintChoice, type BlueprintChoice } from './blueprintChoices'
import { parseBlueprintReference } from './blueprintReference'
import { hasNewerRelease } from './useBlueprintUpdateAvailable'

type UpdateFromBlueprintDialogProps = {
  /** The gadget to update. `upstream` is the blueprint it follows, which the dialog offers first. */
  gadget: { title: string; upstream?: GadgetUpstream; client: RpcStub<GadgetClient> }
  overseer: RpcStub<Overseer>
  publicApi: RpcStub<PublicApi>
  onClose: () => void
  /** Called with the new chat that holds the proposal, once there is one. */
  onProposed: (chatId: number) => void
}

type Load =
  | { status: 'loading' }
  | { status: 'failed' }
  | {
    status: 'loaded'
    models: AiChatAuthorInfo[]
    /** The model a new chat would start with, which reviews a merge unless the user picks another. */
    defaultReviewerId: string | null
    followed: BlueprintPublicInfo | null
  }

/** Whether to update from the followed blueprint, or switch to one the user names. */
type Source = 'followed' | 'switch'

type ReferenceLookup =
  | { status: 'empty' | 'invalid' | 'loading' | 'notFound' | 'failed' }
  | { status: 'found'; blueprint: BlueprintPublicInfo }

/** How the last attempt to apply a blueprint ended, unless it ended in a proposal. */
type Outcome =
  | { kind: 'upToDate' | 'baseUnavailable' | 'unrelated'; blueprint: BlueprintChoice }
  | { kind: 'failed'; blueprint: BlueprintChoice; allowUnrelated: boolean; message: string }

const REFERENCE_MESSAGES: Partial<Record<ReferenceLookup['status'], string>> = {
  invalid: '这不是有效的蓝图 ID 或链接。',
  loading: '正在查找蓝图…',
  notFound: '未找到该 ID 对应的蓝图。',
  failed: '无法查找该蓝图。',
}

const DIALOG_CLASS =
  'responsive-dialog !z-[1000] !top-[clamp(24px,10vh,80px)] !flex !max-h-[calc(100vh-clamp(24px,10vh,80px)-24px)] !w-[min(520px,calc(100vw-32px))] !-translate-y-0 flex-col overflow-hidden bg-kumo-base p-0'

const BODY_TEXT = 'm-0 text-[13px] leading-[18px] tracking-[-0.25px] text-kumo-subtle'

// The merge is recorded as a minimal diff, which is slow to find between files that share little.
const APPLYING_NOTE =
  '正在准备更新。蓝图与应用的共同内容较少时，可能需要几分钟。'

// A merge is only as good as the base it is worked out from, which is the newest version the
// gadget and the blueprint have in common. With none, the confirm step's warning applies.
const SWITCH_NOTE =
  '新蓝图必须与此应用基于相同的版本，例如应用原蓝图的改编版本。如果两者没有共同历史，合并前会提示你。接受更新后，应用将跟随新蓝图。'

const describeChoice = (choice: BlueprintChoice, status: string | null) => (
  <>
    <span className="block">版本 {choice.version}{status && ` · ${status}`}</span>
    {choice.description && <span className="line-clamp-2">{choice.description}</span>}
  </>
)

/**
 * Proposes merging a blueprint's current release into a gadget (see GadgetClient.applyBlueprint()):
 * the blueprint the gadget follows, or, as an advanced option, another one the user names by ID
 * or link. The proposal lands in a new chat, where it is previewed and accepted, so nothing here
 * changes the gadget. Mount it while it should be open.
 */
export const UpdateFromBlueprintDialog = ({
  gadget,
  overseer,
  publicApi,
  onClose,
  onProposed,
}: UpdateFromBlueprintDialogProps) => {
  const followedId = gadget.upstream?.blueprintId

  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [source, setSource] = useState<Source>(followedId === undefined ? 'switch' : 'followed')
  const [reference, setReference] = useState<{ text: string; lookup: ReferenceLookup }>(
    { text: '', lookup: { status: 'empty' } },
  )
  const referenceRequest = useRef(0)
  const [applying, setApplying] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  // Wrapped, so that a pick of "No agent" (null) is told from no pick at all.
  const [pickedReviewer, setPickedReviewer] = useState<{ modelId: string | null } | null>(null)
  const selectContainer = useDialogSelectPortalContainer()

  useEffect(() => {
    let cancelled = false
    Promise.all([
      overseer.listModels(),
      followedId === undefined ? null : publicApi.getBlueprint(followedId),
    ]).then(([models, followed]) => {
      if (cancelled) return
      // The same choice a new chat's composer starts on, since a new chat is where this lands.
      setLoad({ status: 'loaded', models, defaultReviewerId: getStoredSelectedModel(models), followed })
    }, err => {
      logRpcFailure('Failed to load the blueprint to update from:', err)
      if (!cancelled) setLoad({ status: 'failed' })
    })
    return () => { cancelled = true }
  }, [overseer, publicApi, followedId, loadAttempt])

  const retryLoad = () => {
    setLoad({ status: 'loading' })
    setLoadAttempt(attempt => attempt + 1)
  }

  const handleReferenceChange = (text: string) => {
    const request = ++referenceRequest.current
    setOutcome(null)
    const blueprintId = parseBlueprintReference(text)
    if (blueprintId === null) {
      setReference({ text, lookup: { status: text.trim() === '' ? 'empty' : 'invalid' } })
      return
    }
    setReference({ text, lookup: { status: 'loading' } })
    publicApi.getBlueprint(blueprintId).then(blueprint => {
      if (referenceRequest.current !== request) return
      setReference({
        text,
        lookup: blueprint === null ? { status: 'notFound' } : { status: 'found', blueprint },
      })
    }, err => {
      logRpcFailure('Failed to look up a blueprint by ID:', err)
      if (referenceRequest.current === request) setReference({ text, lookup: { status: 'failed' } })
    })
  }

  const reviewerId = pickedReviewer
    ? pickedReviewer.modelId
    : load.status === 'loaded' ? load.defaultReviewerId : null

  const pickReviewer = (modelId: string | null) => {
    setPickedReviewer({ modelId })
    // As the composer's selector does, since the chat this opens is where the choice applies.
    persistSelectedModel(modelId)
  }

  const apply = async (blueprint: BlueprintChoice, allowUnrelated: boolean) => {
    if (load.status !== 'loaded') return
    setApplying(true)
    try {
      const result = await gadget.client.applyBlueprint(blueprint.id, {
        modelId: reviewerId,
        ...(allowUnrelated ? { allowUnrelated } : {}),
      })
      if (result.outcome === 'proposed') onProposed(result.chatId)
      else setOutcome({ kind: result.outcome, blueprint })
    } catch (err) {
      // What the server says is worth showing as it is. In particular it is how the user learns
      // that the gadget changed while the update was being worked out, which trying again cures.
      const transient = logRpcFailure('Failed to apply a blueprint:', err)
      const message = transient || !(err instanceof Error) || !err.message
        ? '准备更新时出错。'
        : err.message
      setOutcome({ kind: 'failed', blueprint, allowUnrelated, message })
    } finally {
      setApplying(false)
    }
  }

  const followed = load.status === 'loaded' && load.followed ? load.followed : null
  const followedChoice = followed && toBlueprintChoice(followed)
  const namedChoice = reference.lookup.status === 'found'
    ? toBlueprintChoice(reference.lookup.blueprint)
    : null
  // With no followed blueprint to offer, naming another is the only way to update.
  const selected = source === 'switch' || !followedChoice ? namedChoice : followedChoice

  // A blueprint stored before releases were commits names no release to compare with, and a
  // gadget made before gadgets recorded the release they took has none to compare. Either gets
  // neither status.
  const followedStatus =
    !followed || gadget.upstream?.commitId === undefined ||
      followed.metadata.commitId === undefined ? null
      : hasNewerRelease(gadget.upstream, followed.metadata) ? '有可用更新'
        : '已是最新版本'

  const header = (title: string, description: string) => (
    <div className="flex shrink-0 items-start justify-between gap-4 border-b border-kumo-line px-4 py-5 sm:px-6">
      <div className="min-w-0">
        <Dialog.Title className="text-[17px] leading-6 font-medium tracking-[-0.35px] text-kumo-default">
          {title}
        </Dialog.Title>
        <Dialog.Description className="mt-1 text-[13px] leading-[18px] font-normal tracking-[-0.25px] text-kumo-subtle">
          {description}
        </Dialog.Description>
      </div>
      <Dialog.Close
        render={props => (
          <WorkshopIconButton {...props} disabled={applying} aria-label="关闭">
            <X size={18} />
          </WorkshopIconButton>
        )}
      />
    </div>
  )

  const actions = (buttons: ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <p role="status" className="m-0 min-w-0 text-[12px] leading-4 tracking-[-0.2px] text-kumo-subtle">
        {applying && APPLYING_NOTE}
      </p>
      <div className="flex shrink-0 items-center gap-2">{buttons}</div>
    </div>
  )

  const switchForm = () => (
    <div className="space-y-2">
      <p className={BODY_TEXT}>{SWITCH_NOTE}</p>
      <WorkshopInput
        aria-label="蓝图 ID 或链接"
        placeholder="粘贴蓝图 ID 或链接"
        value={reference.text}
        onChange={event => handleReferenceChange(event.target.value)}
        disabled={applying}
        className="w-full"
      />
      <div role="status" className={`${BODY_TEXT} empty:hidden`}>
        {namedChoice ? (
          <>
            <span className="block font-medium text-kumo-default">{namedChoice.title}</span>
            {describeChoice(namedChoice, null)}
          </>
        ) : REFERENCE_MESSAGES[reference.lookup.status]}
      </div>
    </div>
  )

  const reviewerField = (models: readonly AiChatAuthorInfo[]) => (
    <Select
      label="审核智能体"
      description={
        '如果你自定义过此应用，智能体会确保这些更改与新版本兼容。选择“无智能体”可自行检查。'
      }
      className="w-full text-sm [&_button]:!h-9"
      container={selectContainer}
      value={toModelSelectValue(reviewerId)}
      onValueChange={value => pickReviewer(fromModelSelectValue(String(value)))}
      renderValue={value => value === NO_AGENT_OPTION_VALUE
        ? '无智能体'
        : models.find(model => model.id === value)?.name ?? String(value)}
      disabled={applying}
    >
      {models.map(model => (
        <Select.Option key={model.id} value={model.id}>{model.name}</Select.Option>
      ))}
      <Select.Option value={NO_AGENT_OPTION_VALUE}>无智能体</Select.Option>
    </Select>
  )

  const outcomeBanner = () => {
    switch (outcome?.kind) {
      case 'upToDate':
        return (
          <Banner
            size="sm"
            title="已是最新版本"
            description={`此应用已使用 ${outcome.blueprint.title} 的最新版本。`}
          />
        )
      case 'baseUnavailable':
        return (
          <Banner
            variant="alert"
            size="sm"
            title="无法合并此更新"
            description={
              `此应用与 ${outcome.blueprint.title} 有共同的早期版本，但无法获取该版本的文件来合并。`
            }
          />
        )
      case 'failed':
        return (
          <Banner
            variant="error"
            size="sm"
            title="无法准备更新"
            description={outcome.message}
            action={
              <Banner.Action
                onClick={() => apply(outcome.blueprint, outcome.allowUnrelated)}
                disabled={applying}
              >
                重试
              </Banner.Action>
            }
          />
        )
      default:
        return null
    }
  }

  const unrelated = outcome?.kind === 'unrelated' ? outcome.blueprint : null

  return (
    <Dialog.Root open onOpenChange={nextOpen => { if (!nextOpen && !applying) onClose() }}>
      <Dialog className={DIALOG_CLASS} size="lg">
        {unrelated ? (
          <>
            {header('无关的蓝图', `此应用与 ${unrelated.title} 没有共同历史。`)}
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
              {/* Kumo's Banner announces nothing itself, and this replaces what was on screen. */}
              <div role="alert">
                <Banner
                  variant="alert"
                  size="sm"
                  title="你自己的更改可能会被撤销"
                  description={
                    '由于没有共同版本，系统只能猜测此应用的原始版本作为合并基准。你的更改如果恰好被包含在猜测版本中，可能会被误认为蓝图删除的内容并被撤销，且不会报告冲突。'
                  }
                />
              </div>
              <p className={BODY_TEXT}>
                更新将在新对话中打开，你可以在接受前检查结果。接受之前不会更改任何内容。
              </p>
            </div>
            <div className="shrink-0 border-t border-kumo-line px-4 py-4 sm:px-6">
              {actions((
                <>
                  <WorkshopButton
                    className="!h-9"
                    onClick={() => setOutcome(null)}
                    disabled={applying}
                    // The button that led here is gone, and took the focus with it.
                    autoFocus
                  >
                    返回
                  </WorkshopButton>
                  <WorkshopButton tone="primary" onClick={() => apply(unrelated, true)} disabled={applying}>
                    {applying ? '正在准备更新…' : '仍然更新'}
                  </WorkshopButton>
                </>
              ))}
            </div>
          </>
        ) : (
          <>
            {header(
              '从蓝图更新',
              `将蓝图的最新版本合并到 ${gadget.title}。更新会在新对话中打开，你可以在接受前试用。`,
            )}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
              {load.status === 'loading' ? (
                <div className="flex justify-center py-6"><Loader size="base" /></div>
              ) : load.status === 'failed' ? (
                <Banner
                  variant="error"
                  size="sm"
                  title="无法加载蓝图"
                  action={<Banner.Action onClick={retryLoad}>重试</Banner.Action>}
                />
              ) : !followedChoice ? (
                <>
                  <p className={BODY_TEXT}>
                    {followedId === undefined
                      ? '无法确定此应用的原始蓝图，请粘贴用于更新的蓝图 ID 或链接。'
                      : '此应用跟随的蓝图已不可用，你可以切换到其他蓝图。'}
                  </p>
                  {switchForm()}
                </>
              ) : (
                <>
                  <Radio.Group
                    appearance="card"
                    value={source}
                    onValueChange={value => {
                      setSource(value)
                      setOutcome(null)
                    }}
                    disabled={applying}
                  >
                    <Radio.Legend className="sr-only">用于更新的蓝图</Radio.Legend>
                    <Radio.Item
                      value="followed"
                      label={`从 ${followedChoice.title} 更新`}
                      description={describeChoice(followedChoice, followedStatus)}
                    />
                    <Radio.Item
                      value="switch"
                      label="高级：切换蓝图"
                      description="通过 ID 或链接指定其他蓝图来更新。"
                    />
                  </Radio.Group>
                  {source === 'switch' && switchForm()}
                </>
              )}
              {load.status === 'loaded' && reviewerField(load.models)}
            </div>

            <div className="shrink-0 space-y-3 border-t border-kumo-line px-4 py-4 sm:px-6">
              {/* Always present, so that what arrives in it is announced: Kumo's Banner announces
                  nothing itself. */}
              <div aria-live="polite" className="empty:hidden">{outcomeBanner()}</div>
              {actions((
                <>
                  <WorkshopButton className="!h-9" onClick={onClose} disabled={applying}>
                    取消
                  </WorkshopButton>
                  <WorkshopButton
                    tone="primary"
                    onClick={() => { if (selected) void apply(selected, false) }}
                    disabled={applying || !selected}
                  >
                    {applying ? '正在准备更新…' : '更新'}
                  </WorkshopButton>
                </>
              ))}
            </div>
          </>
        )}
      </Dialog>
    </Dialog.Root>
  )
}
