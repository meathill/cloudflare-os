// Admin panel for the models a deployment provides through AI Gateway.
//
// The list is the server's: every write is followed by a re-read, and each control shows what the
// server reported rather than what was just chosen.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Select, Switch, useKumoToastManager } from '@cloudflare/kumo'
import { GATEWAY_MODEL_MODES, REASONING_LEVELS } from '@gadgets/workshop-shared/api'
import type {
  AdminApi,
  AdminModel,
  AdminModelView,
  AdminSettingsView,
  AiModelProvider,
  GatewayModelMode,
  GatewayModelSettings,
  ReasoningLevel,
} from '@gadgets/workshop-shared/api'
import type { RpcStub } from 'capnweb'
import DeleteConfirmationDialog from '../../components/DeleteConfirmationDialog'
import { AddGatewayModelForm } from './AddGatewayModelForm'
import { GatewayModelRow, MODES } from './GatewayModelRow'
import { GatewayProviders } from './GatewayProviders'
import { rpcFailureDescription } from '../../rpcErrors'
import { PROVIDER_LABELS, REASONING_LEVEL_LABELS } from './modelForm'
import { fetchModelsDev, suggestModels } from './modelsDev'
import { useGatewayTests } from './useGatewayTests'

const CARD = 'rounded-xl border border-kumo-line bg-kumo-elevated p-6'
const GROUP_HEADING = 'mb-2 text-sm font-semibold text-kumo-default'
const USER_MODELS_LABEL = '允许用户添加自己的模型'
const MODELS_DEV_LABEL = '从 models.dev 推荐模型'
const DEFAULT_REASONING_LABEL = '默认推理级别'

// The default-level select's value while the deployment sets no level.
const BUILT_IN = 'built-in'

// The control that has focus, for a write to give focus back to. A pick in a select is made with
// focus on an option in its list, which closes on the pick, so the select stands in for the option.
// A dialog places focus itself as it closes, so a control in one is left to it.
const focusedControl = () => {
  const focused = document.activeElement
  if (focused?.closest('[role="dialog"]')) return null
  const list = focused?.closest('[role="listbox"]')
  const select = list && Array.from(document.querySelectorAll<HTMLElement>('[aria-controls]'))
    .find((control) => control.getAttribute('aria-controls') === list.id)
  return select ?? (focused instanceof HTMLElement ? focused : null)
}

/** A deployment-wide setting: its name and what it does, beside the control that changes it. */
const SettingRow = ({ label, help, children }: {
  label: string
  /** What the setting does, under the ID that the control is described by. */
  help: { id: string; text: ReactNode }
  children: ReactNode
}) => (
  <div className="mb-4 flex items-center gap-4 rounded-lg border border-kumo-line bg-kumo-base px-4 py-3">
    <div className="min-w-0 flex-1 text-sm">
      <p className="font-medium text-kumo-default">{label}</p>
      <p id={help.id} className="mt-0.5 text-kumo-subtle">{help.text}</p>
    </div>
    {children}
  </div>
)

const SettingSwitch = ({ label, checked, disabled, onChange, children }: {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  /** What the setting does, which also describes the switch. */
  children: ReactNode
}) => {
  const help = useId()
  return (
    <SettingRow label={label} help={{ id: help, text: children }}>
      <Switch
        aria-label={label}
        aria-describedby={help}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </SettingRow>
  )
}

const DefaultReasoningSetting = ({ level, disabled, onChange }: {
  /** The deployment's default level, or null while it sets none. */
  level: ReasoningLevel | null
  disabled: boolean
  onChange: (level: ReasoningLevel | null) => void
}) => {
  const help = useId()
  return (
    <SettingRow
      label={DEFAULT_REASONING_LABEL}
      help={{
        id: help,
        text:
          '适用于列表中未单独设置推理级别的模型。选择内置时不设置统一级别，各模型使用自己的默认方式：服务商默认、固定级别或不发送级别。如果模型不支持指定级别，将使用最接近的可用级别。标题、摘要、应用模型绑定等单次调用以及用户添加的模型不受影响。',
      }}
    >
      <Select<ReasoningLevel | typeof BUILT_IN>
        aria-label={DEFAULT_REASONING_LABEL}
        // Kumo's Select hands its trigger a name and nothing else, so the help reaches it here.
        render={<button aria-describedby={help} />}
        className="w-36 shrink-0"
        disabled={disabled}
        value={level ?? BUILT_IN}
        onValueChange={(value, { reason }) => {
          // Only a pick sets the level, and not a letter typed while the select is closed.
          if (reason !== 'item-press' || !value || value === (level ?? BUILT_IN)) return
          onChange(value === BUILT_IN ? null : value)
        }}
        renderValue={(value) => (value === BUILT_IN ? '内置' : REASONING_LEVEL_LABELS[value])}
      >
        <Select.Option value={BUILT_IN}>内置</Select.Option>
        {REASONING_LEVELS.map((option) => (
          <Select.Option key={option} value={option}>{REASONING_LEVEL_LABELS[option]}</Select.Option>
        ))}
      </Select>
    </SettingRow>
  )
}

export const AdminModelsPanel = ({ admin, gatewayModels, onChanged }: {
  admin: RpcStub<AdminApi>
  /** What the server last reported. Absent when the deployment isn't in AI Gateway mode. */
  gatewayModels: AdminSettingsView['gatewayModels']
  /** Re-read the settings after a write, so that the panel shows what the server holds. */
  onChanged: () => Promise<void>
}) => {
  const toasts = useKumoToastManager()
  const [busy, setBusy] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<AdminModel | null>(null)
  const [pendingDisable, setPendingDisable] = useState<AdminModel | null>(null)
  // The models' tests, by model ID. Like a provider's test, one neither takes nor waits for the
  // lock. A write to a model forgets its test, and a write to the default level forgets them all.
  const modelTests = useGatewayTests((modelId: string) => admin.testGatewayModel(modelId))
  // What this panel's one request for the models.dev list settled with: the list, or undefined
  // when the request failed. Null until then.
  const [modelsDev, setModelsDev] = useState<{ list: unknown } | null>(null)
  const modelsDevRequest = useRef<AbortController | null>(null)
  useEffect(() => () => modelsDevRequest.current?.abort(), [])
  // A write disables every control, and a browser takes focus from a control that becomes disabled
  // without giving it back. So the control that had focus when the write began gets it again once
  // the controls are enabled, unless focus has gone elsewhere since. A control that left the
  // document in the meantime takes no focus.
  const focusBeforeWrite = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (busy) return
    if (document.activeElement === document.body) focusBeforeWrite.current?.focus()
    focusBeforeWrite.current = null
  }, [busy])

  if (!gatewayModels) {
    return (
      <div className={CARD}>
        <h2 className="mb-1 text-lg font-semibold text-kumo-strong">模型</h2>
        <p className="text-sm text-kumo-subtle">
          仅当部署通过 AI Gateway（<code className="font-mono text-xs">CF_AI_GATEWAY</code>）提供模型时，才在这里管理。否则，每位用户需要在自己的服务商页面添加模型。
        </p>
      </div>
    )
  }

  const reportFailure = (title: string, err: unknown) => {
    console.error(`${title}:`, err)
    toasts.add({ title, description: rpcFailureDescription(err), variant: 'error' })
  }

  // Every write funnels through here, so writes can't overlap and each is followed by a re-read.
  // Rejects with the write's own failure; a failed re-read is reported here instead, because the
  // write before it went through.
  const write = async (op: () => Promise<void>) => {
    focusBeforeWrite.current = focusedControl()
    setBusy(true)
    try {
      await op()
      await onChanged().catch((err) => reportFailure('Saved, but couldn’t reload the models', err))
    } finally {
      setBusy(false)
    }
  }

  // A write to one model. Its test was of the model as it was, so a write that goes through
  // forgets it, before the re-read and whatever comes of that.
  const writeModel = (model: AdminModel, op: () => Promise<void>) =>
    write(async () => {
      await op()
      modelTests.clearTest(model.id)
    })

  const changeMode = (model: AdminModel, mode: GatewayModelMode) =>
    writeModel(model, () => admin.setGatewayModelMode(model.id, mode))
      .catch((err) => reportFailure(`无法更新 ${model.name}`, err))

  // Disabling breaks what runs on the model with nobody there to see it fail, so it is confirmed.
  const requestMode = (model: AdminModel, mode: GatewayModelMode) => {
    if (mode === 'disabled') setPendingDisable(model)
    else void changeMode(model, mode)
  }

  const changeSettings = (model: AdminModel, settings: GatewayModelSettings) =>
    writeModel(model, () => admin.setGatewayModelSettings(model.id, settings))
      .catch((err) => reportFailure(`无法更新 ${model.name}`, err))

  // The default is the level of every model that has none of its own, so every test is forgotten.
  const changeDefaultReasoning = (level: ReasoningLevel | null) =>
    write(async () => {
      await admin.setDefaultReasoning(level)
      modelTests.clearTests()
    }).catch((err) => reportFailure(`无法更新“${DEFAULT_REASONING_LABEL}”`, err))

  const changeUserModels = (enabled: boolean) =>
    write(() => admin.setUserModelsEnabled(enabled))
      .catch((err) => reportFailure(`无法更新“${USER_MODELS_LABEL}”`, err))

  const changeModelsDevSuggestions = (enabled: boolean) =>
    write(() => admin.setModelsDevSuggestions(enabled))
      .catch((err) => reportFailure(`无法更新“${MODELS_DEV_LABEL}”`, err))

  const changeProviderEnabled = (provider: AiModelProvider, enabled: boolean) =>
    write(() => admin.setGatewayProviderEnabled(provider, enabled))
      .catch((err) => reportFailure(`无法更新 ${PROVIDER_LABELS[provider]}`, err))

  // Runs when the add form's Model ID field is first turned to, and at most once for as long as
  // the panel is mounted: the list is several megabytes, and a failure only costs the suggestions.
  const loadModelsDev = () => {
    if (modelsDevRequest.current) return
    const request = new AbortController()
    modelsDevRequest.current = request
    fetchModelsDev(request.signal).then(
      (list) => setModelsDev({ list }),
      (err) => {
        if (request.signal.aborted) return
        console.error('Failed to load the models.dev list:', err)
        setModelsDev({ list: undefined })
      },
    )
  }

  const confirmRemoval = async () => {
    if (!pendingRemoval) return
    await writeModel(pendingRemoval, () => admin.removeGatewayModel(pendingRemoval.id))
      .catch((err) => reportFailure(`无法移除 ${pendingRemoval.name}`, err))
    setPendingRemoval(null)
  }

  const confirmDisable = async () => {
    if (!pendingDisable) return
    await changeMode(pendingDisable, 'disabled')
    setPendingDisable(null)
  }

  const catalogByProvider = new Map<AiModelProvider, AdminModelView[]>()
  for (const model of gatewayModels.models) {
    if (model.added) continue
    const group = catalogByProvider.get(model.provider)
    if (group) group.push(model)
    else catalogByProvider.set(model.provider, [model])
  }
  const added = gatewayModels.models.filter((model) => model.added)
  const { userModelsEnabled, defaultReasoning } = gatewayModels
  const suggestions = gatewayModels.modelsDevSuggestions
    ? {
        models: suggestModels(
          modelsDev?.list, gatewayModels.providers, gatewayModels.models.map((model) => model.id)),
        // Nothing to suggest even counting the models already here: the request failed, or what
        // it returned is not the list.
        unavailable: modelsDev !== null
          && suggestModels(modelsDev.list, gatewayModels.providers, []).length === 0,
        onEngage: loadModelsDev,
      }
    : undefined

  return (
    <div className={CARD}>
      <h2 className="mb-1 text-lg font-semibold text-kumo-strong">模型</h2>
      <p className="mb-4 text-sm text-kumo-subtle">
        此部署通过 AI Gateway 提供的模型包括当前版本中已启用服务商的模型目录，以及此部署添加的模型。使用默认设置的模型会在部署升级时跟随目录更新。
      </p>

      <SettingSwitch
        label={USER_MODELS_LABEL}
        checked={userModelsEnabled}
        disabled={busy}
        onChange={changeUserModels}
      >
        启用后，用户可在服务商页面使用自己的 ID 添加模型，并通过此部署的网关运行。关闭后只能使用这里列出的模型，用户已添加的模型会停止工作，直到重新启用。不会删除任何内容。
      </SettingSwitch>

      <DefaultReasoningSetting
        level={defaultReasoning}
        disabled={busy}
        onChange={changeDefaultReasoning}
      />

      <section className="mb-6">
        <h3 className={GROUP_HEADING}>服务商</h3>
        {/* A test is not a write: it changes nothing, so it neither takes nor waits for the lock. */}
        <GatewayProviders
          providers={gatewayModels.providerSettings}
          busy={busy}
          onEnabledChange={changeProviderEnabled}
          onTest={(provider) => admin.testGatewayProvider(provider)}
        />
      </section>

      <dl className="mb-3 grid gap-x-3 gap-y-1 rounded-lg border border-kumo-line bg-kumo-base px-4 py-3 text-sm sm:grid-cols-[auto_1fr]">
        {GATEWAY_MODEL_MODES.map((mode) => (
          <div key={mode} className="contents">
            <dt className="font-medium text-kumo-default">{MODES[mode].label}</dt>
            <dd className="text-kumo-subtle">{MODES[mode].meaning}</dd>
          </div>
        ))}
      </dl>
      <p className="mb-6 text-sm text-kumo-subtle">
        测试会以对话的方式向模型发送一次请求，使用当前推理级别并显示返回结果。一次测试最多使用 2,048 个输出 token。
      </p>

      <div className="flex flex-col gap-6">
        {catalogByProvider.size === 0 && (
          <p className="text-sm text-kumo-subtle">
            当前版本的模型目录中没有已启用服务商的模型。
          </p>
        )}

        {[...catalogByProvider].map(([provider, models]) => (
          <section key={provider}>
            <h3 className={GROUP_HEADING}>{PROVIDER_LABELS[provider]}</h3>
            <ul className="flex flex-col gap-2">
              {models.map((model) => (
                <GatewayModelRow
                  key={model.id}
                  model={model}
                  defaultReasoning={defaultReasoning}
                  poolProviders={gatewayModels.providers}
                  busy={busy}
                  test={modelTests.tests.get(model.id)}
                  onModeChange={(mode) => requestMode(model, mode)}
                  onSettingsChange={(settings) => changeSettings(model, settings)}
                  onTest={() => modelTests.startTest(model.id)}
                />
              ))}
            </ul>
          </section>
        ))}

        <section>
          <h3 className={GROUP_HEADING}>此部署添加的模型</h3>
          {added.length === 0 ? (
            <p className="text-sm text-kumo-subtle">尚未添加模型。</p>
          ) : (
            <>
              <ul className="flex flex-col gap-2">
                {added.map((model) => (
                  <GatewayModelRow
                    key={model.id}
                    model={model}
                    defaultReasoning={defaultReasoning}
                    behavesLikeName={catalogByProvider.get(model.provider)
                      ?.find((listed) => listed.id === model.behavesLike)?.name}
                    busy={busy}
                    test={modelTests.tests.get(model.id)}
                    onModeChange={(mode) => requestMode(model, mode)}
                    onSettingsChange={(settings) => changeSettings(model, settings)}
                    onTest={() => modelTests.startTest(model.id)}
                    onRemove={() => setPendingRemoval(model)}
                  />
                ))}
              </ul>
              <p className="mt-2 text-xs leading-4 text-kumo-subtle">
                要关闭模型，请将其禁用。移除模型会释放其 ID：应用中指向此模型的绑定{userModelsEnabled ? '将继续运行，即使该模型之前已禁用。' : '将保持停止，直到允许用户添加自己的模型。'}
              </p>
            </>
          )}

          <h4 className="mb-2 mt-5 text-sm font-medium text-kumo-default">添加模型</h4>
          {gatewayModels.providers.length === 0 ? (
            <p className="text-sm text-kumo-subtle">
              没有启用的服务商，无法添加模型。请先在服务商设置中启用。
            </p>
          ) : (
            <>
              <SettingSwitch
                label={MODELS_DEV_LABEL}
                checked={gatewayModels.modelsDevSuggestions}
                disabled={busy}
                onChange={changeModelsDevSuggestions}
              >
                添加模型时，浏览器会下载 models.dev 的公开模型列表，以提供模型 ID、名称、限制和能力建议。建议只会填写表单，点击“添加模型”后才会添加。
              </SettingSwitch>
              <AddGatewayModelForm
                providers={gatewayModels.providers}
                behavesLikeOptions={
                  gatewayModels.models.filter((model) => !model.added && model.runtimeKnown)}
                disabled={busy}
                suggestions={suggestions}
                onAdd={(model) => write(() => admin.addGatewayModel(model))}
                onTest={(model) => admin.testNewGatewayModel(model)}
              />
            </>
          )}
        </section>
      </div>

      <DeleteConfirmationDialog
        open={pendingRemoval !== null}
        title={`移除“${pendingRemoval?.name ?? ''}”？`}
        description={
          <>
            移除会释放 ID <span className="break-all font-mono">{pendingRemoval?.id}</span>：应用中指向此模型的绑定{userModelsEnabled ? '将继续运行，即使该模型之前已禁用' : '将保持停止，直到允许用户添加自己的模型'}。使用相同 ID 添加的新模型将替代引用它的对话中的模型。要关闭模型，请选择禁用。
          </>
        }
        confirmLabel="移除"
        confirmingLabel="正在移除…"
        isDeleting={busy}
        onOpenChange={(open) => { if (!open) setPendingRemoval(null) }}
        onConfirm={() => { void confirmRemoval() }}
      />

      <DeleteConfirmationDialog
        open={pendingDisable !== null}
        title={`禁用“${pendingDisable?.name ?? ''}”？`}
        description={
          <>
            使用此模型的对话、应用和定时任务都会停止工作，直到重新启用或隐藏该模型。持续失败的定时任务最终会永久停止，重新启用模型也不会重启它。若只想从选择器中移除模型且不影响现有功能，请选择隐藏。
          </>
        }
        confirmLabel="禁用"
        confirmingLabel="正在禁用…"
        isDeleting={busy}
        onOpenChange={(open) => { if (!open) setPendingDisable(null) }}
        onConfirm={() => { void confirmDisable() }}
      />
    </div>
  )
}
