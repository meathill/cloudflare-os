import { useRef, useState, type FormEvent } from 'react'
import { Autocomplete, Button, Input, Select } from '@cloudflare/kumo'
import { Plus } from '@phosphor-icons/react'
import { REASONING_LEVELS } from '@gadgets/workshop-shared/api'
import type {
  AiModelProvider,
  GatewayModel,
  GatewayModelCapabilities,
  GatewayModelLevelTest,
  ReasoningLevel,
} from '@gadgets/workshop-shared/api'
import { GatewayLevelTestsStatus, GatewayTestButton } from './GatewayTest'
import { PROVIDER_LABELS, REASONING_LEVEL_LABELS, parseTokenLimit } from './modelForm'
import type { ModelSuggestion } from './modelsDev'
import { useFieldErrorAlert } from './useFieldErrorAlert'
import { useGatewayTests } from './useGatewayTests'

const TOKEN_LIMIT_ERROR = '请输入大于零的整数 token 数'
const BEHAVES_LIKE_HELP =
  '此处选择的模型为新模型提供思考格式，以及未在此指定的推理级别和图片输入能力，直到当前版本识别新模型为止。识别后不再使用此选择。名称、限制和费用不会继承。'
// What a capability field shows while nothing is stated in it.
const NOT_STATED = '未指定'
const REASONING_LEVELS_HELP =
  '模型可使用的推理级别。对于不支持推理的模型，只选择“关闭”。'
const MODEL_ID = {
  label: '模型 ID',
  description:
    '模型在服务商 API 中的名称。对话和偏好设置通过此名称引用模型。',
}
const TEST_HELP =
  '测试将按未设置推理级别和添加后列出的每个推理级别分别发送一次请求。每次请求最多使用 2,048 个输出 token，测试不会添加模型。'

/**
 * The form an admin describes a new gateway model with. It checks only what the server would
 * refuse outright as malformed; whether the ID is free and the provider usable is the server's to
 * say, and its refusal is shown as it is, beside the values that caused it. The model the form
 * describes can be tested before it is added. A test is of the model as described, so its results
 * show only while the form describes that model, and an edit and an add each forget them.
 */
export const AddGatewayModelForm = ({
  providers, behavesLikeOptions, disabled, suggestions, onAdd, onTest,
}: {
  /** The providers a model may be added under. Not empty. */
  providers: readonly AiModelProvider[]
  /** The models, of any provider, that a new model of the same provider may behave like. */
  behavesLikeOptions: readonly GatewayModel[]
  /**
   * Whether the form is locked, because a write to the models is in flight. Its test writes
   * nothing, so it is not locked.
   */
  disabled: boolean
  /**
   * Present while the Model ID field suggests models. Picking one only fills the form in: what is
   * added is what the form holds when it is submitted.
   */
  suggestions?: {
    /** The models to suggest, each under the provider it belongs to. */
    models: readonly ModelSuggestion[]
    /** Whether the suggestions could not be loaded. */
    unavailable: boolean
    /** Called whenever the Model ID field is turned to, which is when suggestions are wanted. */
    onEngage: () => void
  }
  /** Adds the model. Rejects with the server's refusal. */
  onAdd: (model: GatewayModel) => Promise<void>
  /** Tests the model as described, without adding it. Rejects when the test could not be run. */
  onTest: (model: GatewayModel) => Promise<GatewayModelLevelTest[]>
}) => {
  const [chosenProvider, setChosenProvider] = useState(providers[0])
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const [outputLimit, setOutputLimit] = useState('')
  const [chosenBehavesLike, setChosenBehavesLike] = useState<string | null>(null)
  // What is stated of the model: null and an empty list each state nothing.
  const [imageInput, setImageInput] = useState<boolean | null>(null)
  const [reasoningLevels, setReasoningLevels] = useState<ReasoningLevel[]>([])
  // Field errors stay out of sight until an add or a test is attempted, so an untouched form
  // isn't red.
  const [errorsShown, setErrorsShown] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const fieldError = useFieldErrorAlert()
  // The ID a picked suggestion filled the form in with.
  const [pickedId, setPickedId] = useState<string | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const idRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const contextWindowRef = useRef<HTMLInputElement>(null)
  const outputLimitRef = useRef<HTMLInputElement>(null)

  const provider = providers.includes(chosenProvider) ? chosenProvider : providers[0]
  const behavesLikeOffered = behavesLikeOptions.filter((option) => option.provider === provider)
  const behavesLike = behavesLikeOffered.find((option) => option.id === chosenBehavesLike)
  // The chosen provider's suggestions whose ID holds what is typed. Matched here rather than by
  // the field, which would report itself expanded over a list with nothing in it.
  const typed = id.trim().toLowerCase()
  const offered = suggestions?.models.filter((suggestion) =>
    suggestion.provider === provider && suggestion.id.toLowerCase().includes(typed)) ?? []
  const contextWindowTokens = parseTokenLimit(contextWindow)
  const outputLimitTokens = parseTokenLimit(outputLimit)
  const fields = [
    { ref: idRef, error: id.trim() ? undefined : '请输入模型 ID' },
    { ref: nameRef, error: name.trim() ? undefined : '请输入显示名称' },
    { ref: contextWindowRef, error: contextWindowTokens ? undefined : TOKEN_LIMIT_ERROR },
    {
      ref: outputLimitRef,
      error: outputLimitTokens === null ? `${TOKEN_LIMIT_ERROR}，或留空` : undefined,
    },
  ]
  const [idError, nameError, contextWindowError, outputLimitError] =
    fields.map((field) => (errorsShown ? field.error : undefined))
  const capabilities: GatewayModelCapabilities = {
    ...(imageInput !== null && { imageInput }),
    ...(reasoningLevels.length > 0 && { reasoningLevels }),
  }
  const model: GatewayModel | null =
    id.trim() && name.trim() && contextWindowTokens && outputLimitTokens !== null
      ? {
          provider,
          id: id.trim(),
          name: name.trim(),
          contextWindow: contextWindowTokens,
          ...(outputLimitTokens && { outputLimit: outputLimitTokens }),
          ...(behavesLike && { behavesLike: behavesLike.id }),
          ...(Object.keys(capabilities).length > 0 && { capabilities }),
        }
      : null
  // A test is kept under the model it is of. The form comes to describe another model without an
  // edit when the lists it is given lose the provider or the model to behave like, and the test of
  // the model it described before is then not shown. `testDescribed` starts a test only for a form
  // that describes a model.
  const testKey = JSON.stringify(model)
  const { tests, startTest, clearTests } =
    useGatewayTests<string, GatewayModelLevelTest[]>(() => onTest(model!))
  const test = tests.get(testKey)

  // What every edit does: the refusal and the test were of the model as it was described.
  const edited = () => {
    setRefusal(null)
    clearTests()
  }

  const edit = (setValue: (value: string) => void) => (event: { target: { value: string } }) => {
    setValue(event.target.value)
    edited()
    fieldError.clear()
  }

  const clear = () => {
    setId('')
    setName('')
    setContextWindow('')
    setOutputLimit('')
    setChosenBehavesLike(null)
    setImageInput(null)
    setReasoningLevels([])
    setErrorsShown(false)
    setPickedId(null)
    clearTests()
  }

  // The model the form describes. While a field is in error there is none: the errors are then
  // shown, and the first field in error is pointed at.
  const validate = () => {
    const invalid = fields.find((field) => field.error)
    if (model && !invalid) return model
    setErrorsShown(true)
    if (invalid?.error) fieldError.pointAt(invalid.ref.current, invalid.error)
    return null
  }

  const testDescribed = () => {
    if (validate()) startTest(testKey)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (disabled) return
    setRefusal(null)
    const described = validate()
    if (!described) return
    try {
      await onAdd(described)
    } catch (err) {
      console.error('Failed to add gateway model:', err)
      setRefusal(err instanceof Error && err.message ? err.message : '无法添加模型。')
      return
    }
    clear()
  }

  return (
    <form noValidate onSubmit={submit} className="grid items-start gap-4 sm:grid-cols-2">
      <Select<AiModelProvider>
        label="服务商"
        className="w-full"
        disabled={disabled}
        value={provider}
        onValueChange={(value) => {
          edited()
          if (!value || value === provider) return
          setChosenProvider(value)
          setChosenBehavesLike(null)
          // A suggested model belongs to the provider it was suggested under, so it does not
          // follow the form to another one.
          if (pickedId !== null && pickedId === id.trim()) clear()
        }}
        renderValue={(value) => PROVIDER_LABELS[value]}
      >
        {providers.map((option) => (
          <Select.Option key={option} value={option}>
            {PROVIDER_LABELS[option]}
          </Select.Option>
        ))}
      </Select>
      {suggestions ? (
        // Kumo's Autocomplete hands out no ref to its input, and takes neither a focus handler nor
        // aria-invalid for it, so all three go through this wrapper.
        <div
          ref={(wrapper) => {
            idRef.current = wrapper?.querySelector<HTMLInputElement>('[role="combobox"]') ?? null
            idRef.current?.setAttribute('aria-invalid', String(idError !== undefined))
          }}
          className="grid gap-2"
          onFocus={suggestions.onEngage}
        >
          <Autocomplete<ModelSuggestion>
            label={MODEL_ID.label}
            description={MODEL_ID.description}
            error={idError}
            items={offered}
            filter={null}
            open={listOpen && offered.length > 0}
            onOpenChange={(open) => setListOpen(open)}
            itemToStringValue={(suggestion) => suggestion.id}
            value={id}
            disabled={disabled}
            onValueChange={(value, { reason }) => {
              suggestions.onEngage()
              // With the list closed, Escape asks to empty the field. What was typed stays.
              if (reason === 'escape-key') return
              edit(setId)({ target: { value } })
              const picked =
                reason === 'item-press' && offered.find((suggestion) => suggestion.id === value)
              if (!picked) return
              setPickedId(picked.id)
              setName(picked.name)
              setContextWindow(String(picked.contextWindow))
              setOutputLimit(String(picked.outputLimit ?? ''))
              setImageInput(picked.capabilities?.imageInput ?? null)
              setReasoningLevels(picked.capabilities?.reasoningLevels ?? [])
            }}
          >
            <Autocomplete.InputGroup />
            <Autocomplete.Content>
              <Autocomplete.List>
                {(suggestion: ModelSuggestion) => (
                  <Autocomplete.Item key={suggestion.id} value={suggestion}>
                    <span className="block break-all font-mono text-sm">{suggestion.id}</span>
                    <span className="block text-xs text-kumo-subtle">{suggestion.name}</span>
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Content>
          </Autocomplete>
          {suggestions.unavailable && (
            <p role="status" className="text-sm leading-snug text-kumo-subtle">
              无法加载 models.dev 的建议，请手动输入模型详情。
            </p>
          )}
        </div>
      ) : (
        <Input
          ref={idRef}
          label={MODEL_ID.label}
          description={MODEL_ID.description}
          value={id}
          disabled={disabled}
          onChange={edit(setId)}
          error={idError}
          aria-invalid={idError !== undefined}
        />
      )}
      <Input
        ref={nameRef}
        label="显示名称"
        description="显示在模型列表中。"
        value={name}
        disabled={disabled}
        onChange={edit(setName)}
        error={nameError}
        aria-invalid={nameError !== undefined}
      />
      <Input
        ref={contextWindowRef}
        label="上下文窗口"
        inputMode="numeric"
        description="单次请求允许的最大 token 数。"
        value={contextWindow}
        disabled={disabled}
        onChange={edit(setContextWindow)}
        error={contextWindowError}
        aria-invalid={contextWindowError !== undefined}
      />
      <Input
        ref={outputLimitRef}
        label="输出上限"
        required={false}
        inputMode="numeric"
        description="单次响应的最大 token 数，也会从上下文窗口中预留。"
        value={outputLimit}
        disabled={disabled}
        onChange={edit(setOutputLimit)}
        error={outputLimitError}
        aria-invalid={outputLimitError !== undefined}
      />
      {behavesLikeOffered.length > 0 && (
        <Select<string | null>
          label="行为类似于"
          labelTooltip={BEHAVES_LIKE_HELP}
          required={false}
          className="w-full"
          placeholder="无"
          disabled={disabled}
          value={behavesLike?.id ?? null}
          onValueChange={(value) => {
            edited()
            setChosenBehavesLike(value)
          }}
          renderValue={() => behavesLike?.name}
        >
          <Select.Option value={null}>无</Select.Option>
          {behavesLikeOffered.map((option) => (
            <Select.Option key={option.id} value={option.id}>{option.name}</Select.Option>
          ))}
        </Select>
      )}
      <Select<boolean | null>
        label="图片输入"
        description="模型是否支持在文本之外输入图片。"
        required={false}
        className="w-full"
        placeholder={NOT_STATED}
        disabled={disabled}
        value={imageInput}
        onValueChange={(value) => {
          edited()
          setImageInput(value)
        }}
        renderValue={(value) => (value ? '是' : '否')}
      >
        <Select.Option value={null}>{NOT_STATED}</Select.Option>
        <Select.Option value={true}>是</Select.Option>
        <Select.Option value={false}>否</Select.Option>
      </Select>
      <Select<ReasoningLevel, true>
        multiple
        label="推理级别"
        description={REASONING_LEVELS_HELP}
        required={false}
        className="w-full"
        placeholder={NOT_STATED}
        disabled={disabled}
        value={reasoningLevels}
        onValueChange={(levels) => {
          edited()
          // In the order of the levels, whichever order they were picked in.
          setReasoningLevels(REASONING_LEVELS.filter((level) => levels.includes(level)))
        }}
        // The placeholder shows for a value rendered as nothing, which an empty list is not.
        renderValue={(levels) =>
          levels.map((level) => REASONING_LEVEL_LABELS[level]).join(', ') || undefined}
      >
        {REASONING_LEVELS.map((level) => (
          <Select.Option key={level} value={level}>{REASONING_LEVEL_LABELS[level]}</Select.Option>
        ))}
      </Select>
      <div className="flex min-w-0 flex-col items-start gap-2 sm:col-span-2">
        {fieldError.alert}
        {refusal && (
          <p role="alert" className="text-sm leading-snug text-kumo-danger">
            {refusal}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="secondary" icon={Plus} disabled={disabled}>
            添加模型
          </Button>
          <GatewayTestButton
            name="此模型"
            size="base"
            testing={test?.state === 'testing'}
            onTest={testDescribed}
          />
        </div>
        {/* As wide as the form and no wider, so that a provider's long message wraps. */}
        <div className="self-stretch">
          <p className="text-xs leading-4 text-kumo-subtle">{TEST_HELP}</p>
          <GatewayLevelTestsStatus test={test} />
        </div>
      </div>
    </form>
  )
}
