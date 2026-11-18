import { useState } from 'react'
import { Button, Loader, useKumoToastManager } from '@cloudflare/kumo'
import type { BillingPlan, BillingUsageRange } from '@gadgets/workshop-shared/billing'
import { UserBillingDialog } from './admin/UserBillingDialog'
import { formatUsd } from './formatUsd'
import { emptyAccount, type BillingAdmin } from './useBillingAdmin'

const PLAN_LABELS: Record<BillingPlan, string> = { standard: '普通', internal: '内部' }

/** A user's plan, balance and markup in the admin user list, plus the billing detail dialog. */
const UserBillingCell = ({ billing, userKey, range }: {
  billing: BillingAdmin
  userKey: string
  range: BillingUsageRange
}) => {
  const toasts = useKumoToastManager()
  const [switching, setSwitching] = useState(false)
  const [open, setOpen] = useState(false)
  const known = billing.accounts.get(userKey)
  if (known === undefined) return <div className="flex justify-end"><Loader size="sm" /></div>
  const account = known ?? emptyAccount(userKey)

  const togglePlan = async () => {
    setSwitching(true)
    try {
      billing.replace(await billing.api.setPlan(userKey, account.plan === 'internal' ? 'standard' : 'internal'))
    } catch (err) {
      toasts.add({ title: err instanceof Error ? err.message : '切换失败', variant: 'error' })
    } finally {
      setSwitching(false)
    }
  }

  // effectiveMarkup 为 0 说明账户还没建出来（或拿不到默认倍率），这时只显示「默认」。
  const markupText = account.plan === 'internal'
    ? '—'
    : account.markup === null
      ? (account.effectiveMarkup > 0 ? `默认 ${account.effectiveMarkup}x` : '默认')
      : `${account.markup}x`

  return (
    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
      <span className="font-mono text-xs text-kumo-default">{formatUsd(account.balanceUsd)}</span>
      <Button size="sm" variant="secondary" loading={switching} onClick={togglePlan}
        aria-label={`${userKey} 当前为${PLAN_LABELS[account.plan]}用户，点击切换`}>
        {PLAN_LABELS[account.plan]}
      </Button>
      <span className="text-xs text-kumo-subtle">{markupText}</span>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>详情</Button>
      {open && (
        <UserBillingDialog
          account={account}
          billing={billing.api}
          range={range}
          onClose={() => setOpen(false)}
          onUpdated={billing.replace}
        />
      )}
    </div>
  )
}

export default UserBillingCell
