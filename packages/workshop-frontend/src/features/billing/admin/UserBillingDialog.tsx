import { useState, type FormEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { Banner, Button, Dialog, Input, useKumoToastManager } from '@cloudflare/kumo'
import type { BillingAdminClient } from '@gadgets/workshop-shared/api'
import type { BillingAccountInfo, BillingPlan, BillingUsageRange } from '@gadgets/workshop-shared/billing'
import { formatUsd } from '../formatUsd'
import { UserUsageDetail } from './UserUsageDetail'

const errorMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback

const PLAN_LABELS: Record<BillingPlan, string> = { standard: '普通', internal: '内部' }
const PRESET_MARKUPS = [0, 1, 2]

type MarkupChoice = 'default' | 'custom' | '0' | '1' | '2'

const choiceOf = (account: BillingAccountInfo): MarkupChoice => {
  if (account.markup === null) return 'default'
  return PRESET_MARKUPS.includes(account.markup) ? String(account.markup) as MarkupChoice : 'custom'
}

const SectionTitle = ({ children }: { children: string }) => (
  <h3 className="mb-2 text-sm font-semibold text-kumo-default">{children}</h3>
)

const OverviewItem = ({ label, value, detail }: {
  label: string
  value: string
  detail?: string
}) => (
  <div className="rounded-lg border border-kumo-line bg-kumo-tint/40 px-3 py-2">
    <div className="text-xs text-kumo-subtle">{label}</div>
    <div className="mt-0.5 font-medium text-kumo-default tabular-nums">{value}</div>
    {detail && <div className="text-xs text-kumo-subtle">{detail}</div>}
  </div>
)

/**
 * 单用户计费详情：概况、倍率、余额调整、区间用量、流水与逐次明细。
 * account 由父组件持有，setPlan / setMarkup / grant 成功后经 onUpdated 回流。
 */
export const UserBillingDialog = ({ account, billing, range, onClose, onUpdated }: {
  account: BillingAccountInfo
  billing: RpcStub<BillingAdminClient>
  range: BillingUsageRange
  onClose: () => void
  onUpdated: (account: BillingAccountInfo) => void
}) => {
  const toasts = useKumoToastManager()
  const [error, setError] = useState<string | null>(null)

  const [choice, setChoice] = useState<MarkupChoice>(() => choiceOf(account))
  const [custom, setCustom] = useState(() =>
    choiceOf(account) === 'custom' ? String(account.markup) : '')
  const [savingMarkup, setSavingMarkup] = useState(false)

  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [granting, setGranting] = useState(false)

  const isInternal = account.plan === 'internal'
  // internal 与还没建账户的用户拿不到部署默认倍率，只显示「默认」。
  const defaultLabel = !isInternal && account.markup === null && account.effectiveMarkup > 0
    ? `默认（${account.effectiveMarkup}x）`
    : '默认'

  const customValue = Number(custom)
  const customValid = custom.trim() !== '' && Number.isFinite(customValue)
    && customValue >= 0 && customValue <= 10
  const markupTarget: number | null = choice === 'default'
    ? null
    : choice === 'custom'
      ? (customValid ? Math.round(customValue * 100) / 100 : Number.NaN)
      : Number(choice)
  const canSaveMarkup = !isInternal && (choice !== 'custom' || customValid)
    && markupTarget !== account.markup

  const saveMarkup = async () => {
    if (!canSaveMarkup || savingMarkup) return
    setSavingMarkup(true)
    setError(null)
    try {
      onUpdated(await billing.setMarkup(account.userKey, markupTarget))
      toasts.add({ title: '倍率已更新', variant: 'success' })
    } catch (err) {
      setError(errorMessage(err, '保存倍率失败'))
    } finally {
      setSavingMarkup(false)
    }
  }

  const amountUsd = Number(amount)
  const canGrant = amount.trim() !== '' && Number.isFinite(amountUsd)
    && amountUsd !== 0 && note.trim() !== ''
  const handleGrant = async (e: FormEvent) => {
    e.preventDefault()
    if (!canGrant || granting) return
    setGranting(true)
    setError(null)
    try {
      onUpdated(await billing.grant(account.userKey, amountUsd, note))
      setAmount('')
      setNote('')
      toasts.add({ title: '余额已调整', variant: 'success' })
    } catch (err) {
      setError(errorMessage(err, '调整失败'))
    } finally {
      setGranting(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog className="responsive-dialog max-h-[85vh] overflow-y-auto p-6 sm:w-[860px]" size="xl">
        <Dialog.Title className="mb-1 text-lg font-semibold">{account.userKey}</Dialog.Title>
        <p className="mb-5 text-sm text-kumo-subtle">计费账户详情与区间用量。</p>
        {error && <div className="mb-4"><Banner variant="error" title={error} /></div>}

        <section className="mb-5">
          <SectionTitle>概况</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <OverviewItem label="余额" value={formatUsd(account.balanceUsd)} />
            <OverviewItem label="累计充值" value={formatUsd(account.topUpTotalUsd)}
              detail="充值 / 退款 / 争议净额" />
            <OverviewItem label="方案" value={PLAN_LABELS[account.plan]} />
            <OverviewItem label="累计扣费" value={formatUsd(account.chargedTotalUsd)}
              detail={`原始成本 ${formatUsd(account.rawCostTotalUsd)}`} />
          </div>
        </section>

        <section className="mb-5">
          <SectionTitle>计费倍率</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-kumo-line bg-kumo-elevated p-0.5">
              {(['default', '0', '1', '2', 'custom'] as const).map((option) => {
                const label = option === 'default' ? defaultLabel
                  : option === 'custom' ? '自定义' : `${option}x`
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setChoice(option)}
                    className={[
                      'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                      choice === option
                        ? 'bg-kumo-base text-kumo-default shadow-sm'
                        : 'text-kumo-subtle hover:text-kumo-default',
                    ].join(' ')}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
            {choice === 'custom' && (
              <input
                type="number"
                min={0}
                max={10}
                step={0.01}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="自定义倍率"
                placeholder="0 – 10"
                className="w-24 rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-sm text-kumo-default"
              />
            )}
            <Button size="sm" variant="primary" disabled={!canSaveMarkup}
              loading={savingMarkup} onClick={saveMarkup}>
              保存倍率
            </Button>
          </div>
          {choice === 'custom' && !customValid && custom.trim() !== '' && (
            <p className="mt-1.5 text-xs text-kumo-danger">倍率需为 0 – 10 的数字，最多两位小数。</p>
          )}
          {isInternal && (
            <p className="mt-1.5 text-xs text-kumo-subtle">内部用户不扣费，倍率不生效。</p>
          )}
        </section>

        <section className="mb-6">
          <SectionTitle>余额调整</SectionTitle>
          <form onSubmit={handleGrant} className="flex flex-wrap items-end gap-2">
            <Input className="w-40" label="金额（USD）" inputMode="decimal" value={amount}
              placeholder="例如 20 或 -5" onChange={(e) => setAmount(e.target.value)} />
            <Input className="min-w-48 flex-1" label="原因" value={note}
              placeholder="例如：线下转账 2026-11-12" onChange={(e) => setNote(e.target.value)} />
            <Button type="submit" variant="primary" disabled={!canGrant} loading={granting}>
              确认调整
            </Button>
          </form>
          <p className="mt-1.5 text-xs text-kumo-subtle">输入负数可扣回。</p>
        </section>

        <UserUsageDetail api={billing} userKey={account.userKey} range={range} />
      </Dialog>
    </Dialog.Root>
  )
}
