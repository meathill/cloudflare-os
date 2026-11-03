import { useId } from 'react'
import { Banner, Switch } from '@cloudflare/kumo'
import type {
  AdminGatewayProvider,
  AiModelProvider,
  GatewayModelTest,
} from '@gadgets/workshop-shared/api'
import { GatewayTestButton, GatewayTestStatus } from './GatewayTest'
import { PROVIDER_LABELS } from './modelForm'
import { useGatewayTests, type GatewayTestState } from './useGatewayTests'

const ProviderRow = ({ entry, busy, test, onEnabledChange, onTest }: {
  entry: AdminGatewayProvider
  busy: boolean
  /** Where the provider's last test stands. Absent until one is run. */
  test: GatewayTestState | undefined
  onEnabledChange: (enabled: boolean) => void
  onTest: () => void
}) => {
  const lockedNote = useId()
  const tokenWarning = useId()
  const label = PROVIDER_LABELS[entry.provider]
  const locked = entry.enabledBy === 'environment'
  const described = [locked && lockedNote, entry.needsApiToken && tokenWarning].filter(Boolean)

  return (
    <li className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm font-medium text-kumo-default">{label}</p>
          {locked && (
            <p id={lockedNote} className="mt-0.5 text-xs text-kumo-subtle">
              由 <code className="font-mono">CF_AI_GATEWAY_PROVIDERS</code> 设置
            </p>
          )}
        </div>
        <GatewayTestButton name={label} testing={test?.state === 'testing'} onTest={onTest} />
        <Switch
          aria-label={label}
          aria-describedby={described.join(' ') || undefined}
          checked={entry.enabledBy !== undefined}
          disabled={busy || locked}
          onCheckedChange={onEnabledChange}
        />
      </div>
      {entry.needsApiToken && (
        <Banner
          id={tokenWarning}
          className="mt-2"
          variant="alert"
          size="sm"
          description={
            <>
              需要 <code className="font-mono">CF_AI_GATEWAY_API_TOKEN</code>；部署设置此令牌之前，对该服务商的请求会失败。
            </>
          }
        />
      )}
      <GatewayTestStatus test={test} subject="provider" />
    </li>
  )
}

/**
 * The providers AI Gateway serves, each with the switch that turns it on for the deployment and a
 * test of whether it answers. The tests belong to this list rather than to the server: one runs
 * whatever else the Models tab is doing, and its result stays until the provider is tested again.
 */
export const GatewayProviders = ({ providers, busy, onEnabledChange, onTest }: {
  /** Every provider the gateway serves, on or off, in the order they are listed in. */
  providers: readonly AdminGatewayProvider[]
  /** Whether the switches are locked, because a write to the models is in flight. */
  busy: boolean
  onEnabledChange: (provider: AiModelProvider, enabled: boolean) => void
  /**
   * Asks one of the provider's models through the gateway. A request that fails is a result;
   * rejects when the test could not be run at all.
   */
  onTest: (provider: AiModelProvider) => Promise<GatewayModelTest>
}) => {
  const { tests, startTest } = useGatewayTests(onTest)

  return (
    <>
      <p className="mb-2 text-sm text-kumo-subtle">
        此部署通过 AI Gateway 提供以下服务商的模型。<code className="font-mono text-xs">CF_AI_GATEWAY_PROVIDERS</code> 中列出的服务商始终启用，其他服务商可以在这里启用。服务商密钥和余额保存在网关中，此页面无法查看；请使用测试功能确认服务商是否响应。
      </p>
      <ul className="flex flex-col gap-2">
        {providers.map((entry) => (
          <ProviderRow
            key={entry.provider}
            entry={entry}
            busy={busy}
            test={tests.get(entry.provider)}
            onEnabledChange={(enabled) => onEnabledChange(entry.provider, enabled)}
            onTest={() => startTest(entry.provider)}
          />
        ))}
      </ul>
    </>
  )
}
