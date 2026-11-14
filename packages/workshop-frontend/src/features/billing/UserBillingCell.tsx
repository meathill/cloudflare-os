import { useState } from 'react'
import { Button, Loader, useKumoToastManager } from '@cloudflare/kumo'
import type { BillingPlan } from '@gadgets/workshop-shared/billing'
import BillingAccountDialog from './BillingAccountDialog'
import { formatUsd } from './formatUsd'
import { emptyAccount, type BillingAdmin } from './useBillingAdmin'

const PLAN_LABELS: Record<BillingPlan, string> = { standard: '普通', internal: '内部' }

/** A user's plan and balance in the admin user list, with the plan switch and balance adjustment. */
const UserBillingCell = ({ billing, userKey }: { billing: BillingAdmin; userKey: string }) => {
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

  return (
    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
      <span className="font-mono text-xs text-kumo-default">{formatUsd(account.balanceUsd)}</span>
      <Button size="sm" variant="secondary" loading={switching} onClick={togglePlan}
        aria-label={`${userKey} 当前为${PLAN_LABELS[account.plan]}用户，点击切换`}>
        {PLAN_LABELS[account.plan]}
      </Button>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>余额</Button>
      {open && (
        <BillingAccountDialog account={account} billing={billing.api} onClose={() => setOpen(false)}
          onGranted={(next) => {
            billing.replace(next)
            setOpen(false)
            toasts.add({ title: '余额已调整', variant: 'success' })
          }} />
      )}
    </div>
  )
}

export default UserBillingCell
