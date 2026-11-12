import { useEffect, useState, type FormEvent } from 'react'
import type { RpcStub } from 'capnweb'
import { Banner, Button, Dialog, Input, Loader, useKumoToastManager } from '@cloudflare/kumo'
import { ArrowClockwise, MagnifyingGlass } from '@phosphor-icons/react'
import type { AdminApi, BillingAdminClient } from '@gadgets/workshop-shared/api'
import type { BillingAccountInfo, BillingLedgerEntry, BillingPlan } from '@gadgets/workshop-shared/billing'
import { formatUsd } from './formatUsd'

type AdminBillingPanelProps = {
  admin: RpcStub<AdminApi>
}

const PLAN_LABELS: Record<BillingPlan, string> = { standard: '普通', internal: '内部' }

const errorMessage = (err: unknown, fallback: string) => err instanceof Error ? err.message : fallback

/** The grant dialog: an amount (negative takes credit back) and the reason the ledger records. */
const GrantDialog = ({ account, billing, onClose, onGranted }: {
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
      <Dialog className="responsive-dialog p-6 sm:w-[440px]" size="base">
        <Dialog.Title className="mb-1 text-lg font-semibold">调整余额</Dialog.Title>
        <p className="mb-4 text-sm text-kumo-subtle">
          {account.userKey} · 当前 {formatUsd(account.balanceUsd)}。输入负数可扣回。
        </p>
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

/**
 * 管理员的计费面板：查找用户、切换普通 / 内部方案、手动加额度或扣回、查看流水。
 * 用户没有信用卡时，在这里线下充值。
 */
const AdminBillingPanel = ({ admin }: AdminBillingPanelProps) => {
  const toasts = useKumoToastManager()
  // Wrapped in an object: a stub is callable, which useState would mistake for an updater.
  const [billing, setBilling] = useState<{ api: RpcStub<BillingAdminClient> } | null | 'pending'>('pending')
  const [query, setQuery] = useState('')
  const [accounts, setAccounts] = useState<BillingAccountInfo[] | null>(null)
  const [granting, setGranting] = useState<BillingAccountInfo | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    let disposed = false
    let stub: RpcStub<BillingAdminClient> | null = null
    admin.getBillingAdmin().then((api) => {
      if (disposed) return api?.[Symbol.dispose]()
      stub = api
      setBilling(api ? { api } : null)
    }).catch(() => { if (!disposed) setBilling(null) })
    return () => {
      disposed = true
      stub?.[Symbol.dispose]()
    }
  }, [admin])

  const api = billing === 'pending' ? null : billing?.api ?? null
  useEffect(() => {
    if (!api) return
    let cancelled = false
    api.listAccounts('').then((rows) => { if (!cancelled) setAccounts(rows) }).catch(() => {})
    return () => { cancelled = true }
  }, [api])
  const search = (text: string) => {
    api?.listAccounts(text).then(setAccounts).catch((err) => {
      toasts.add({ title: errorMessage(err, '加载失败'), variant: 'error' })
    })
  }

  if (billing === 'pending') return <div className="flex justify-center py-16"><Loader size="lg" /></div>
  if (!api) {
    return <p className="text-sm text-kumo-subtle">此部署没有开启计费（没有 BILLING binding）。</p>
  }

  const replace = (next: BillingAccountInfo) =>
    setAccounts((rows) => rows?.map((row) => row.userKey === next.userKey ? next : row) ?? [next])

  const togglePlan = async (account: BillingAccountInfo) => {
    setBusy(account.userKey)
    try {
      replace(await api.setPlan(account.userKey, account.plan === 'internal' ? 'standard' : 'internal'))
    } catch (err) {
      toasts.add({ title: errorMessage(err, '切换失败'), variant: 'error' })
    } finally {
      setBusy(null)
    }
  }

  // Cutover helper: everyone the usage panel already knows becomes internal, so the existing team
  // keeps working once billing starts.
  const importExistingUsers = async () => {
    if (!window.confirm('把用量统计里的所有现有用户设为内部用户（只记账不扣费）？')) return
    setImporting(true)
    try {
      const { users } = await admin.getUsageStats()
      for (const user of users) await api.setPlan(user.username, 'internal')
      toasts.add({ title: `已将 ${users.length} 位用户设为内部用户`, variant: 'success' })
      search(query)
    } catch (err) {
      toasts.add({ title: errorMessage(err, '导入失败'), variant: 'error' })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <form className="flex flex-1 items-end gap-2" onSubmit={(e) => { e.preventDefault(); search(query) }}>
          <Input className="w-full" label="搜索用户" placeholder="邮箱或用户名" value={query}
            onChange={(e) => setQuery(e.target.value)} />
          <Button type="submit" variant="secondary" aria-label="搜索"><MagnifyingGlass size={16} /></Button>
          <Button type="button" variant="secondary" aria-label="刷新" onClick={() => search(query)}>
            <ArrowClockwise size={16} />
          </Button>
        </form>
        <Button variant="secondary" onClick={importExistingUsers} loading={importing}>现有用户设为内部</Button>
      </div>
      <p className="text-xs text-kumo-subtle">
        普通用户按原始模型成本的倍率扣费，余额不足时无法使用 AI；内部用户只记账不扣费。没有在线支付条件的用户，可在这里手动加额度。
        找不到的用户可以直接输入完整邮箱后切换方案或加额度。
      </p>

      {accounts === null ? (
        <div className="flex justify-center py-8"><Loader size="base" /></div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-kumo-line">
          {(accounts.length === 0 && query.includes('@')
            ? [{ userKey: query.trim().toLowerCase(), plan: 'standard', balanceUsd: 0, rawCostTotalUsd: 0,
                chargedTotalUsd: 0, createdAt: 0, updatedAt: 0 } satisfies BillingAccountInfo]
            : accounts
          ).map((account) => (
            <div key={account.userKey} className="border-b border-kumo-line last:border-b-0">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left text-kumo-default"
                  onClick={() => setExpanded(expanded === account.userKey ? null : account.userKey)}>
                  {account.userKey}
                </button>
                <span className="text-kumo-subtle">原始成本 {formatUsd(account.rawCostTotalUsd)}</span>
                <span className="text-kumo-subtle">已扣 {formatUsd(account.chargedTotalUsd)}</span>
                <span className="w-20 text-right font-medium text-kumo-default">{formatUsd(account.balanceUsd)}</span>
                <Button size="sm" variant="secondary" loading={busy === account.userKey}
                  onClick={() => togglePlan(account)}>
                  {PLAN_LABELS[account.plan]} · 切换
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setGranting(account)}>调整余额</Button>
              </div>
              {expanded === account.userKey && <LedgerList billing={api} userKey={account.userKey} />}
            </div>
          ))}
          {accounts.length === 0 && !query.includes('@') && (
            <p className="px-4 py-6 text-center text-sm text-kumo-subtle">没有匹配的用户。</p>
          )}
        </div>
      )}

      {granting && (
        <GrantDialog account={granting} billing={api} onClose={() => setGranting(null)}
          onGranted={(account) => {
            replace(account)
            setGranting(null)
            toasts.add({ title: '余额已调整', variant: 'success' })
          }} />
      )}
    </div>
  )
}

export default AdminBillingPanel
