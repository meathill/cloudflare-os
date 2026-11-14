import { useNavigate } from '@tanstack/react-router'
import { Button, Dialog } from '@cloudflare/kumo'
import { Wallet } from '@phosphor-icons/react'
import OutOfCreditsModal from '../../components/billing/OutOfCreditsModal'
import { useBilling } from './BillingContext'
import { formatUsd } from './formatUsd'

type UsageLimitModalProps = {
  open: boolean
  onClose: () => void
}

/**
 * Shown when a turn ends on a usage limit. A prepaid deployment sends the user to top up; any other
 * keeps upstream's free-tier / Cloudflare-credits dialog.
 */
const UsageLimitModal = ({ open, onClose }: UsageLimitModalProps) => {
  const billing = useBilling()
  const navigate = useNavigate()
  if (!billing) return <OutOfCreditsModal open={open} onClose={onClose} />

  const balance = billing.summary?.balanceUsd
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <Dialog className="responsive-dialog p-6 sm:w-[480px]" size="base">
        <Dialog.Title className="mb-2 flex items-center gap-2 text-lg font-semibold">
          <Wallet size={22} weight="bold" className="text-kumo-warning" />
          余额不足
        </Dialog.Title>
        <p className="text-sm text-kumo-subtle">
          {balance !== undefined && <>当前余额 <strong>{formatUsd(balance)}</strong>。</>}
          充值后即可继续创作，已经写好的内容不会丢失。
        </p>
        <div className="flex items-center justify-end gap-2 pt-5">
          <Button variant="secondary" onClick={onClose}>稍后再说</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose()
              void navigate({ to: '/billing' })
            }}
          >
            去充值
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

export default UsageLimitModal
