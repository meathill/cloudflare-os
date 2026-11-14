import { useEffect, useState, type FormEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { Banner, Button, Dialog, Input, Loader } from '@cloudflare/kumo'
import type { BillingAdminClient } from '@gadgets/workshop-shared/api'
import type { BillingAccountInfo, BillingLedgerEntry } from '@gadgets/workshop-shared/billing'
import { formatUsd } from './formatUsd'

const errorMessage = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback

const LedgerList = ({ billing, userKey }: { billing: RpcStub<BillingAdminClient>; userKey: string }) => {
  const [entries, setEntries] = useState<BillingLedgerEntry[] | null>(null)
  useEffect(() => {
    let cancelled = false
    billing.listLedger(userKey, 50).then((rows) => { if (!cancelled) setEntries(rows) }).catch(() => {
      if (!cancelled) setEntries([])
    })
    return () => { cancelled = true }
  }, [billing, userKey])
  if (entries === null) return <div className="px-4 py-3"><Loader size="sm" /></div>
  if (entries.length === 0) return <p className="px-4 py-3 text-sm text-kumo-subtle">没有记录。</p>
  return (
    <ul className="divide-y divide-kumo-line bg-kumo-tint/40">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3 px-4 py-2 text-xs">
          <span className="w-32 shrink-0 text-kumo-subtle">{new Date(entry.createdAt).toLocaleString('zh-CN')}</span>
          <span className="min-w-0 flex-1 truncate text-kumo-default">{entry.note}</span>
          <span className="shrink-0 text-kumo-subtle">{entry.actor}</span>
          <span className="w-16 shrink-0 text-right text-kumo-default">
            {entry.kind === 'plan' ? '' : formatUsd(entry.amountUsd)}
          </span>
        </li>
      ))}
    </ul>
  )
}

/** One user's billing: their ledger, and a balance adjustment (negative takes credit back) with the reason it records. */
const BillingAccountDialog = ({ account, billing, onClose, onGranted }: {
  account: BillingAccountInfo
  billing: RpcStub<BillingAdminClient>
  onClose: () => void
  onGranted: (account: BillingAccountInfo) => void
}) => {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const amountUsd = Number(amount)
  const valid = amount.trim() !== '' && Number.isFinite(amountUsd) && amountUsd !== 0 && note.trim() !== ''

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid || saving) return
    setSaving(true)
    setError(null)
    try {
      onGranted(await billing.grant(account.userKey, amountUsd, note))
    } catch (err) {
      setError(errorMessage(err, '调整失败'))
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog className="responsive-dialog p-6 sm:w-[520px]" size="base">
        <Dialog.Title className="mb-1 text-lg font-semibold">调整余额</Dialog.Title>
        <p className="mb-4 text-sm text-kumo-subtle">
          {account.userKey} · 当前 {formatUsd(account.balanceUsd)}。输入负数可扣回。
        </p>
        <div className="mb-4 max-h-48 overflow-y-auto rounded-lg border border-kumo-line">
          <LedgerList billing={billing} userKey={account.userKey} />
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Banner variant="error" title={error} />}
          <Input label="金额（USD）" inputMode="decimal" value={amount} placeholder="例如 20 或 -5"
            onChange={(e) => setAmount(e.target.value)} autoFocus />
          <Input label="原因" value={note} placeholder="例如：线下转账 2026-11-12"
            onChange={(e) => setNote(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>取消</Button>
            <Button type="submit" variant="primary" disabled={!valid} loading={saving}>确认调整</Button>
          </div>
        </form>
      </Dialog>
    </Dialog.Root>
  )
}

export default BillingAccountDialog
