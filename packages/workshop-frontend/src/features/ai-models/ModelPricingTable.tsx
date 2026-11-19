import { Fragment, useEffect, useState } from 'react'
import { Loader, Table } from '@cloudflare/kumo'
import type { ModelPrice, ModelPricing } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../../AuthContext'
import { PROVIDER_LABELS } from './modelForm'

type PricingState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'done'; models: ModelPricing[] }

// 官方价最多 6 位小数；去掉多余的尾零，0.075 / 2 / 10 原样显示。
function formatPrice(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, '')
}

// Gemini / OpenAI 各成一组；其余（Workers AI、OpenCode Go 等）接入渠道不同但都按厂商官方价计，合为一组。
function groupLabel(provider: ModelPricing['provider']): string {
  return provider === 'google' || provider === 'openai' ? PROVIDER_LABELS[provider] : '其他模型'
}

function priceNote(price: Pick<ModelPrice, 'input' | 'output' | 'cacheRead'>): string {
  return `输入 $${formatPrice(price.input)} · 输出 $${formatPrice(price.output)} · 缓存读取 $${formatPrice(price.cacheRead)}`
}

/** 「模型价格」页签：部署提供给当前用户的语言模型的官方参考单价，仅在页签打开时挂载与取数。 */
export const ModelPricingTable = () => {
  const { authenticatedApi } = useAuthenticatedApi()
  const [state, setState] = useState<PricingState>({ status: 'loading' })

  useEffect(() => {
    let current = true
    authenticatedApi.getModelPricing().then(
      (models) => { if (current) setState({ status: 'done', models }) },
      (err) => {
        console.error('Failed to load model pricing:', err)
        if (current) setState({ status: 'error' })
      },
    )
    return () => { current = false }
  }, [authenticatedApi])

  if (state.status === 'loading') {
    return <div className="flex justify-center py-10"><Loader size="lg" /></div>
  }
  if (state.status === 'error') {
    return <p className="py-10 text-center text-[13px] text-kumo-subtle">模型价格暂时无法加载，请稍后重试。</p>
  }
  if (state.models.length === 0) {
    return <p className="py-10 text-center text-[13px] text-kumo-subtle">暂无模型价格。</p>
  }

  // 归组后保持接口返回的顺序（与模型选择器一致）。
  const groups = new Map<string, ModelPricing[]>()
  for (const model of state.models) {
    const label = groupLabel(model.provider)
    groups.set(label, [...(groups.get(label) ?? []), model])
  }

  return (
    <div className="space-y-5">
      {[...groups.entries()].map(([label, models]) => (
        <section key={label}>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="text-[13px] font-semibold text-kumo-default">{label}</h4>
            <span className="text-[11px] text-kumo-inactive">单位：美元 / 百万 Tokens</span>
          </div>
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>模型</Table.Head>
                <Table.Head className="text-right">输入</Table.Head>
                <Table.Head className="text-right">输出</Table.Head>
                <Table.Head className="text-right">缓存读取</Table.Head>
                <Table.Head className="text-right">缓存写入</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {models.map((model) => {
                const { price, nextPrice } = model
                const notes: string[] = []
                if (price.longContext) {
                  notes.push(
                    `单次输入超过 ${price.longContext.inputTokensAbove / 1000}K Tokens：` +
                    priceNote(price.longContext),
                  )
                }
                if (nextPrice) {
                  const [, month, day] = nextPrice.from.split('-').map(Number)
                  notes.push(`自 ${month} 月 ${day} 日起：` + priceNote(nextPrice.price))
                }
                return (
                  <Fragment key={model.id}>
                    <Table.Row>
                      <Table.Cell>
                        <div className="font-medium">{model.name}</div>
                        <div className="text-[11px] text-kumo-inactive">{model.id}</div>
                      </Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatPrice(price.input)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatPrice(price.output)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">{formatPrice(price.cacheRead)}</Table.Cell>
                      <Table.Cell className="text-right tabular-nums">
                        {price.cacheWrite > 0 ? formatPrice(price.cacheWrite) : '—'}
                      </Table.Cell>
                    </Table.Row>
                    {notes.length > 0 && (
                      <Table.Row>
                        <Table.Cell colSpan={5} className="pt-0 text-[11px] leading-4 text-kumo-subtle">
                          {notes.map((note) => <div key={note}>{note}</div>)}
                        </Table.Cell>
                      </Table.Row>
                    )}
                  </Fragment>
                )
              })}
            </Table.Body>
          </Table>
        </section>
      ))}
      <p className="border-t border-kumo-line pt-3 text-[12px] leading-5 text-kumo-subtle">
        以上为各模型官方参考单价；扣费 = 计费 Tokens × 单价。详见{' '}
        <a
          href="https://ai.google.dev/gemini-api/docs/pricing"
          target="_blank"
          rel="noreferrer"
          className="text-kumo-brand hover:underline"
        >
          Gemini 官方价目表
        </a>
        {' '}与{' '}
        <a
          href="https://developers.openai.com/api/docs/pricing"
          target="_blank"
          rel="noreferrer"
          className="text-kumo-brand hover:underline"
        >
          OpenAI 官方价目表
        </a>
        。
      </p>
    </div>
  )
}
