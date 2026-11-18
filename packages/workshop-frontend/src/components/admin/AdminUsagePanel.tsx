import { useState, useEffect, useMemo, type ReactNode } from 'react'
import type { RpcStub } from 'capnweb'
import { Banner, Button, Input, useKumoToastManager } from '@cloudflare/kumo'
import { ArrowClockwise } from '@phosphor-icons/react'
import type { AdminApi, UsageStatsResponse, UserUsageRecord } from '@gadgets/workshop-shared/api'
import type { BillingUsageTotals } from '@gadgets/workshop-shared/billing'
import { useBillingAccounts, useBillingAdminApi } from '../../features/billing/useBillingAdmin'
import { presetRange } from '../../features/billing/usageRange'
import { UsageRangePicker } from '../../features/billing/UsageRangePicker'
import { useUsageReport } from '../../features/billing/admin/useUsageReport'
import { LEGACY_OVERLAP_RANGE } from '../../features/billing/admin/legacyUsage'
import { UsageReportOverview } from '../../features/billing/admin/UsageReportOverview'
import { UsageBreakdown } from '../../features/billing/admin/UsageBreakdown'
import { AdminUserTable, type UserSortField, type UserSortOrder } from './AdminUserTable'

interface AdminUsagePanelProps {
  admin: RpcStub<AdminApi>
}

const PAGE_SIZE = 50

const SectionCard = ({ title, description, children }: {
  title: string
  description?: string
  children: ReactNode
}) => (
  <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
    <h3 className="text-base font-semibold text-kumo-strong">{title}</h3>
    {description && <p className="text-xs text-kumo-subtle mt-0.5 mb-4">{description}</p>}
    <div className={description ? '' : 'mt-4'}>{children}</div>
  </div>
)

const sortValue = (user: UserUsageRecord, field: UserSortField,
  byUser: ReadonlyMap<string, BillingUsageTotals>): number => {
  const usage = byUser.get(user.username)
  switch (field) {
    case 'requests': return usage?.requests ?? 0
    case 'tokens': return usage
      ? usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
      : 0
    case 'rawCost': return usage?.rawCostUsd ?? 0
    case 'charged': return usage?.chargedUsd ?? 0
    case 'lastActive': return new Date(user.lastActive).getTime()
    case 'createdAt': return new Date(user.createdAt).getTime()
    case 'workspaceCount': return user.workspaceCount
    case 'callCount': return user.callCount
  }
}

export default function AdminUsagePanel({ admin }: AdminUsagePanelProps) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState<UsageStatsResponse | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<UserSortField>('lastActive')
  const [sortOrder, setSortOrder] = useState<UserSortOrder>('desc')
  const [page, setPage] = useState(1)
  const [markingInternal, setMarkingInternal] = useState(false)
  const [range, setRange] = useState(() => presetRange('last30'))
  const toasts = useKumoToastManager()

  const filteredUsers = useMemo(() => {
    if (!data?.users) return []
    let list = [...data.users]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (u) => u.username.toLowerCase().includes(q) || u.displayName.toLowerCase().includes(q),
      )
    }
    return list
  }, [data?.users, searchQuery])

  const billingApi = useBillingAdminApi(admin)
  const { report, error: reportError, reload: reloadReport } = useUsageReport(billingApi ?? undefined, range)
  // 「计费上线前（估算）」用固定区间，不随选择器的时间范围变化。
  const { report: legacyReport } = useUsageReport(billingApi ?? undefined, LEGACY_OVERLAP_RANGE)
  const postLaunchChatUsd = legacyReport?.bySource.find((row) => row.source === 'chat')?.rawCostUsd ?? null
  const preBilling = data?.overview != null && postLaunchChatUsd != null
    ? { legacyTotalUsd: data.overview.totalCost, postLaunchChatUsd }
    : undefined

  const byUser = useMemo(
    () => new Map((report?.byUser ?? []).map((row) => [row.userKey, row])),
    [report],
  )

  const pageCount = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const sortedUsers = useMemo(() => {
    return filteredUsers.toSorted((a, b) => {
      const diff = sortValue(a, sortField, byUser) - sortValue(b, sortField, byUser)
      return sortOrder === 'asc' ? diff : -diff
    })
  }, [filteredUsers, sortField, sortOrder, byUser])
  const visibleUsers = sortedUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const { accounts, replace } = useBillingAccounts(
    billingApi ?? undefined,
    visibleUsers.map((user) => user.username),
  )
  const billing = billingApi ? { api: billingApi, accounts, replace } : null

  async function fetchUsage(isManual = false) {
    if (isManual) setRefreshing(true)
    try {
      setData(await admin.getUsageStats())
      // 只有手动刷新才重拉报表；首次加载由 useUsageReport 自己的 effect 负责——
      // 这里的闭包可能仍持有 billingApi 尚未就绪时的旧 reload，调用它会作废进行中的请求。
      if (isManual) reloadReport()
      if (isManual) toasts.add({ title: '用量数据已更新', variant: 'success' })
    } catch (err) {
      toasts.add({
        title: err instanceof Error ? err.message : '获取用量统计失败',
        variant: 'error',
      })
    } finally {
      setLoading(false)
      if (isManual) setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchUsage(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin])

  // 有缘心之助：开启计费前把现有团队都设为内部用户（只记账不扣费）。
  async function markAllInternal() {
    if (!billing || !data || !window.confirm(`把这 ${data.users.length} 位用户都设为内部用户（只记账不扣费）？`)) return
    setMarkingInternal(true)
    try {
      for (const user of data.users) billing.replace(await billing.api.setPlan(user.username, 'internal'))
      toasts.add({ title: `已将 ${data.users.length} 位用户设为内部用户`, variant: 'success' })
    } catch (err) {
      toasts.add({ title: err instanceof Error ? err.message : '设置失败', variant: 'error' })
    } finally {
      setMarkingInternal(false)
    }
  }

  function handleSort(field: UserSortField) {
    setPage(1)
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 bg-kumo-elevated border border-kumo-line rounded-xl">
        <ArrowClockwise size={24} className="animate-spin text-kumo-subtle mr-2" />
        <p className="text-sm text-kumo-subtle">正在加载全平台用量统计...</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* 头部标题、区间与刷新 */}
      <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-kumo-strong">用量统计与用户行为看板</h2>
            <p className="text-sm text-kumo-subtle mt-1">
              全平台用户的活跃行为、剧本/工作区数量以及模型调用 Token 消耗实时汇总。
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => fetchUsage(true)}
            loading={refreshing} disabled={refreshing}>
            <ArrowClockwise size={16} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新数据
          </Button>
        </div>
        {billingApi && (
          <div className="mt-4">
            <UsageRangePicker value={range} onValueChange={setRange} />
          </div>
        )}
      </div>

      {billing && (
        <>
          <SectionCard title="计费概览">
            {reportError ? (
              <Banner variant="error" title={reportError} />
            ) : report ? (
              <UsageReportOverview report={report} stats={data?.overview ?? null} preBilling={preBilling} />
            ) : (
              <div className="py-6 text-sm text-kumo-subtle">正在加载计费报表...</div>
            )}
          </SectionCard>

          {report && (
            <SectionCard title="用量构成" description="按北京时间归组；Token 为实际用量。">
              <UsageBreakdown report={report} />
            </SectionCard>
          )}
        </>
      )}

      {/* 用户明细列表 */}
      <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-kumo-strong">用户用量明细</h3>
            <p className="text-xs text-kumo-subtle mt-0.5">
              共统计到 {data?.users.length ?? 0} 位用户数据，按活跃度及用量展示。
            </p>
          </div>
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {billing && (
              <Button variant="secondary" loading={markingInternal} onClick={markAllInternal}>全部设为内部</Button>
            )}
            <Input className="sm:w-64" aria-label="搜索用户"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value)
                setPage(1)
              }}
              placeholder="搜索用户名或昵称..."
            />
          </div>
        </div>
        <AdminUserTable
          users={visibleUsers}
          totalCount={filteredUsers.length}
          page={currentPage}
          onPageChange={setPage}
          sortField={sortField}
          sortOrder={sortOrder}
          onSort={handleSort}
          byUser={billing ? byUser : null}
          billing={billing}
          range={range}
          searching={searchQuery.trim() !== ''}
        />
      </div>
    </div>
  )
}
