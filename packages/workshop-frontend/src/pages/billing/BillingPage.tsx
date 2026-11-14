import { useEffect, useState } from 'react'
import { Banner, Button, Loader, useKumoToastManager } from '@cloudflare/kumo'
import { Lightning, Wallet } from '@phosphor-icons/react'
import type { BillingLedgerEntry, BillingUsageDay } from '@gadgets/workshop-shared/billing'
import { useDocumentTitle } from '../../useDocumentTitle'
import { useBilling } from '../../features/billing/BillingContext'
import { formatUsd } from '../../features/billing/formatUsd'

const LEDGER_KIND_LABELS: Record<BillingLedgerEntry['kind'], string> = {
  topup: '在线充值',
  grant: '管理员调整',
  refund: '退款',
  dispute: '支付争议',
  plan: '计费方案',
}

// After a Checkout, Stripe's webhook usually lands within seconds: re-read a few times.
const TOPUP_POLL_MS = [1_500, 4_000, 10_000]

type DayTotal = { day: string; chargedUsd: number; requests: number }

const totalsByDay = (usage: BillingUsageDay[]): DayTotal[] => {
  const days = new Map<string, DayTotal>()
  for (const row of usage) {
    const total = days.get(row.day) ?? { day: row.day, chargedUsd: 0, requests: 0 }
    total.chargedUsd += row.chargedUsd
    total.requests += row.requests
    days.set(row.day, total)
  }
  return [...days.values()]
}

const SectionLabel = ({ children }: { children: string }) => (
  <h2 className="px-1 text-[12px] font-medium uppercase tracking-[0.08em] text-kumo-inactive">{children}</h2>
)

type BillingPageProps = {
  /** `?topup=` as Stripe Checkout returns to this page. */
  topup?: 'success' | 'cancelled'
}

const BillingPage = ({ topup }: BillingPageProps) => {
  useDocumentTitle('余额与充值')
  const billing = useBilling()
  const toasts = useKumoToastManager()
  const [ledger, setLedger] = useState<BillingLedgerEntry[] | null>(null)
  const [usage, setUsage] = useState<DayTotal[] | null>(null)
  const [checkoutTier, setCheckoutTier] = useState<number | null>(null)

  const api = billing?.api
  const balance = billing?.summary?.balanceUsd
  useEffect(() => {
    if (!api) return
    let cancelled = false
    api.listLedger(20).then((rows) => { if (!cancelled) setLedger(rows) }).catch(() => {})
    api.listUsage(30).then((rows) => { if (!cancelled) setUsage(totalsByDay(rows)) }).catch(() => {})
    return () => { cancelled = true }
  }, [api, balance])

  const refresh = billing?.refresh
  useEffect(() => {
    if (topup !== 'success' || !refresh) return
    const timers = TOPUP_POLL_MS.map((delay) => setTimeout(refresh, delay))
    return () => timers.forEach(clearTimeout)
  }, [topup, refresh])

  if (!billing) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-10">
        <p className="text-sm text-kumo-subtle">此部署没有开启计费。</p>
      </div>
    )
  }

  const startCheckout = async (tierUsd: number) => {
    setCheckoutTier(tierUsd)
    try {
      const { url } = await billing.api.createCheckout(tierUsd)
      window.location.assign(url)
    } catch (err) {
      toasts.add({ title: '无法发起充值', description: err instanceof Error ? err.message : undefined, variant: 'error' })
      setCheckoutTier(null)
    }
  }

  const summary = billing.summary
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-8 sm:px-8">
      <header>
        <h1 className="text-2xl font-semibold text-kumo-default">余额与充值</h1>
        <p className="mt-1 text-sm text-kumo-subtle">先充值后使用。每次调用 AI 模型后，按实际用量从余额扣费。</p>
      </header>

      {topup === 'success' && (
        <Banner variant="default" title="支付成功">余额通常在几秒内到账；没有变化时请稍后刷新本页。</Banner>
      )}
      {topup === 'cancelled' && <Banner variant="default" title="已取消支付，余额没有变化。" />}

      <section className="flex flex-col gap-3">
        <SectionLabel>当前余额</SectionLabel>
        <div className="rounded-xl border border-kumo-line bg-kumo-base p-5">
          {!summary ? (
            <Loader size="base" />
          ) : (
            <div className="flex flex-col gap-2">
              <p className="flex items-center gap-2 text-3xl font-semibold text-kumo-default">
                <Wallet size={28} className="text-kumo-subtle" />
                {formatUsd(summary.balanceUsd)}
              </p>
              <p className="text-sm text-kumo-subtle">
                {summary.plan === 'internal'
                  ? '内部账号：用量照常记录，但不扣费，也不受余额限制。'
                  : `按模型官方价格的 ${summary.markup} 倍扣费。余额用完后需要充值才能继续使用 AI。`}
              </p>
            </div>
          )}
        </div>
      </section>

      {summary && summary.plan === 'standard' && (
        <section className="flex flex-col gap-3">
          <SectionLabel>充值</SectionLabel>
          <div className="rounded-xl border border-kumo-line bg-kumo-base p-5">
            {summary.topUpEnabled ? (
              <div className="flex flex-wrap gap-2">
                {summary.topUpTiersUsd.map((tier) => (
                  <Button
                    key={tier}
                    variant="secondary"
                    onClick={() => startCheckout(tier)}
                    loading={checkoutTier === tier}
                    disabled={checkoutTier !== null}
                  >
                    <Lightning size={14} weight="bold" />
                    充值 ${tier}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-kumo-subtle">在线充值暂未开通，请联系管理员充值。</p>
            )}
            <p className="mt-3 text-xs text-kumo-subtle">
              支付由 Stripe 处理，可用银行卡、支付宝、微信支付等方式。无法在线支付时，可以联系管理员线下充值。
            </p>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <SectionLabel>近 30 天用量</SectionLabel>
        <div className="rounded-xl border border-kumo-line bg-kumo-base">
          {usage === null ? (
            <div className="p-5"><Loader size="base" /></div>
          ) : usage.length === 0 ? (
            <p className="p-5 text-sm text-kumo-subtle">还没有用量。</p>
          ) : (
            <ul className="divide-y divide-kumo-line">
              {usage.map((day) => (
                <li key={day.day} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="text-kumo-default">{day.day}</span>
                  <span className="text-kumo-subtle">{day.requests} 次请求</span>
                  <span className="font-medium text-kumo-default">{formatUsd(day.chargedUsd)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <SectionLabel>充值与调整记录</SectionLabel>
        <div className="rounded-xl border border-kumo-line bg-kumo-base">
          {ledger === null ? (
            <div className="p-5"><Loader size="base" /></div>
          ) : ledger.length === 0 ? (
            <p className="p-5 text-sm text-kumo-subtle">还没有记录。</p>
          ) : (
            <ul className="divide-y divide-kumo-line">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <span className="w-20 shrink-0 text-kumo-subtle">{LEDGER_KIND_LABELS[entry.kind]}</span>
                  <span className="min-w-0 flex-1 truncate text-kumo-default">{entry.note}</span>
                  <span className="shrink-0 text-kumo-subtle">
                    {new Date(entry.createdAt).toLocaleDateString('zh-CN')}
                  </span>
                  {entry.kind !== 'plan' && (
                    <span className="w-20 shrink-0 text-right font-medium text-kumo-default">
                      {entry.amountUsd > 0 ? '+' : ''}{formatUsd(entry.amountUsd)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

export default BillingPage
