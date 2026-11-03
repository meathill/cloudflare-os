import { useId, useRef, useState, type FormEvent } from 'react'
import { Button, Input } from '@cloudflare/kumo'
import type { AiModelProvider } from '@gadgets/workshop-shared/api'
import { PROVIDER_LABELS, parseAllowedModels } from './modelForm'
import { useFieldErrorAlert } from './useFieldErrorAlert'

const POOL_DOCS = 'https://developers.cloudflare.com/ai-gateway/features/auto-router/#models'

const malformedError = (name: string) =>
  `“${name}” is not a gateway model name. Name each model as provider/model, like ` +
  'anthropic/claude-sonnet-5.5, or a provider’s every model, like anthropic/*'

/**
 * The gateway models the Auto Router model may pick, edited as one comma-separated line the way
 * the gateway's own allow-list takes them. Blank leaves the router every model of the providers
 * that are on, which the field names so the admin can see the pool the rule resolves to.
 */
export const AllowedModelsField = ({ modelName, allowedModels, providers, busy, onChange }: {
  modelName: string
  /** The list the server holds, or undefined while the router picks among the enabled providers. */
  allowedModels: string[] | undefined
  /** The providers that are on, whose models the router picks among while the list is unset. */
  providers: readonly AiModelProvider[]
  busy: boolean
  /** Called with the list to store, or undefined to unset it. */
  onChange: (allowedModels: string[] | undefined) => void
}) => {
  // What is typed into the field, or null while the field shows the server's list.
  const [draft, setDraft] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const facts = useId()
  const alert = useFieldErrorAlert()

  const held = allowedModels?.join(', ') ?? ''
  const text = draft ?? held
  const parsed = parseAllowedModels(text)
  const error = 'malformed' in parsed ? malformedError(parsed.malformed) : undefined

  const edit = (next: string | null) => {
    setDraft(next)
    alert.clear()
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!('names' in parsed)) {
      alert.pointAt(ref.current, error!)
      return
    }
    edit(null)
    const saved = parsed.names.length > 0 ? parsed.names : undefined
    if (saved?.join(',') !== allowedModels?.join(',')) onChange(saved)
  }

  const reset = () => {
    edit(null)
    // The button leaves with the list it resets, so focus moves to the field first.
    ref.current?.focus()
    onChange(undefined)
  }

  return (
    <form noValidate onSubmit={save} className="grid content-start gap-2 sm:col-span-2">
      <Input
        ref={ref}
        label={<>允许的模型<span className="sr-only">（{modelName}）</span></>}
        placeholder="所有已启用服务商的模型"
        value={text}
        disabled={busy}
        onChange={(event) => edit(event.target.value)}
        error={error}
        aria-invalid={error !== undefined}
        aria-describedby={facts}
      />
      <p id={facts} className="text-sm leading-snug text-kumo-subtle">
        {providers.length > 0 ? (
          <>
            留空时，自动模式从已启用的服务商（
            {providers.map((provider) => PROVIDER_LABELS[provider]).join(', ')}）的{' '}
            <a href={POOL_DOCS} target="_blank" rel="noreferrer" className="underline">
              Cloudflare 模型池
            </a>
            .
          </>
        ) : (
          <>没有可供自动选择的已启用服务商，请在上方启用。</>
        )}{' '}
        如需缩小范围，请用逗号分隔模型的网关名称：{' '}
        <span className="font-mono">anthropic/claude-sonnet-5.5</span>,{' '}
        <span className="font-mono">anthropic/*</span> 或{' '}
        <span className="font-mono">@cf/*/*</span>. 在上方禁用模型不会将其从模型池中移除；在此列出模型才会限制范围。保存后请点击测试：网关不认识的模型名称会导致每次请求失败。
      </p>
      {alert.alert}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="secondary"
          size="sm"
          disabled={busy}
          aria-label={`保存 ${modelName} 的允许模型`}
        >
          保存
        </Button>
        {allowedModels !== undefined && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            aria-label={`重置 ${modelName} 的允许模型`}
            onClick={reset}
          >
            重置
          </Button>
        )}
      </div>
    </form>
  )
}
