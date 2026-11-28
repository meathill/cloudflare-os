import { Pagination } from '@cloudflare/kumo'
import { SortAscending, SortDescending } from '@phosphor-icons/react'
import type { UserUsageRecord } from '@gadgets/workshop-shared/api'
import type { BillingUsageRange, BillingUsageTotals } from '@gadgets/workshop-shared/billing'
import UserBillingCell from '../../features/billing/UserBillingCell'
import { formatUsd4 } from '../../features/billing/formatUsd'
import { preBillingUsd, type PreBillingEstimate } from '../../features/billing/admin/legacyUsage'
import type { BillingAdmin } from '../../features/billing/useBillingAdmin'

export type UserSortField =
  | 'lastActive' | 'createdAt' | 'workspaceCount' | 'callCount'
  | 'requests' | 'tokens' | 'rawCost' | 'charged' | 'preBilling'
export type UserSortOrder = 'asc' | 'desc'

const PAGE_SIZE = 50
const PAGINATION_LABELS = {
  navigation: '用户分页', firstPage: '第一页', previousPage: '上一页', nextPage: '下一页', lastPage: '最后一页',
  pageNumber: '页码',
}

const num = (n: number) => n.toLocaleString('zh-CN')
const tokenTotal = (row: BillingUsageTotals | undefined) =>
  row ? row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens : 0

function formatDateTime(iso: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function formatRelativeTime(iso: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDays = Math.floor(diffHour / 24)
  if (diffDays < 30) return `${diffDays} 天前`
  return formatDateTime(iso)
}

const SortableHead = ({ field, label, sortField, sortOrder, onSort, align = 'left', title }: {
  field: UserSortField
  label: string
  sortField: UserSortField
  sortOrder: UserSortOrder
  onSort: (field: UserSortField) => void
  align?: 'left' | 'right'
  title?: string
}) => (
  <th className={`py-3 px-4 cursor-pointer hover:text-kumo-strong transition-colors ${align === 'right' ? 'text-right' : ''}`}
    title={title} onClick={() => onSort(field)}>
    <div className={`flex items-center gap-1 ${align === 'right' ? 'justify-end' : ''}`}>
      <span>{label}</span>
      {sortField === field && (
        sortOrder === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
      )}
    </div>
  </th>
)

/** 用户用量明细表：行为数据列 + 区间内计费数据列（有计费时）。纯展示，排序/分页由父组件持有。 */
export const AdminUserTable = ({ users, totalCount, page, onPageChange, sortField, sortOrder,
  onSort, byUser, preBillingByUser, billing, range, searching }: {
  users: UserUsageRecord[]
  totalCount: number
  page: number
  onPageChange: (page: number) => void
  sortField: UserSortField
  sortOrder: UserSortOrder
  onSort: (field: UserSortField) => void
  byUser: ReadonlyMap<string, BillingUsageTotals> | null
  preBillingByUser: ReadonlyMap<string, PreBillingEstimate> | null
  billing: BillingAdmin | null
  range: BillingUsageRange
  searching: boolean
}) => {
  const colSpan = billing ? 11 : 5
  const head = (field: UserSortField, label: string, align?: 'right') => (
    <SortableHead field={field} label={label} sortField={sortField} sortOrder={sortOrder}
      onSort={onSort} align={align} />
  )

  return (
    <>
      <div className="overflow-x-auto border border-kumo-line rounded-lg">
        <table className="w-full text-left text-sm border-collapse">
          <thead>
            <tr className="bg-kumo-base/80 border-b border-kumo-line text-xs font-medium text-kumo-subtle select-none">
              <th className="py-3 px-4">用户</th>
              {head('workspaceCount', '剧本项目', 'right')}
              {head('callCount', 'AI 会话轮次', 'right')}
              {billing && head('requests', '区间请求', 'right')}
              {billing && head('tokens', '区间 Tokens', 'right')}
              {billing && head('rawCost', '原始成本', 'right')}
              {billing && head('charged', '扣费', 'right')}
              {billing && (
                <SortableHead field="preBilling" label="计费上线前" sortField={sortField}
                  sortOrder={sortOrder} onSort={onSort} align="right"
                  title="按 Token 估算的旧统计减去计费上线后对话成本，不随时间范围变化" />
              )}
              {head('lastActive', '最后活跃')}
              {head('createdAt', '首次进入')}
              {billing && <th className="py-3 px-4 text-right">余额 · 方案</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-kumo-line/60">
            {users.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="py-12 text-center text-kumo-subtle text-sm">
                  {searching ? '没有找到符合条件的用户' : '暂无用户活动记录'}
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const usage = byUser?.get(user.username)
                return (
                  <tr key={user.username} className="hover:bg-kumo-tint/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-kumo-tint flex items-center justify-center text-xs font-semibold text-kumo-strong border border-kumo-line flex-shrink-0">
                          {user.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-kumo-strong truncate">{user.displayName}</div>
                          <div className="text-xs text-kumo-subtle truncate">{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-right text-kumo-default">{user.workspaceCount}</td>
                    <td className="py-3 px-4 font-mono text-right text-kumo-default">{num(user.callCount)}</td>
                    {billing && (
                      <td className="py-3 px-4 font-mono text-right text-kumo-default">
                        {num(usage?.requests ?? 0)}
                      </td>
                    )}
                    {billing && (
                      <td className="py-3 px-4 font-mono text-right text-kumo-default">
                        {num(tokenTotal(usage))}
                      </td>
                    )}
                    {billing && (
                      <td className="py-3 px-4 font-mono text-right text-xs text-kumo-default">
                        {formatUsd4(usage?.rawCostUsd ?? 0)}
                      </td>
                    )}
                    {billing && (
                      <td className="py-3 px-4 font-mono text-right text-xs font-medium text-kumo-strong">
                        {formatUsd4(usage?.chargedUsd ?? 0)}
                      </td>
                    )}
                    {billing && (
                      <td className="py-3 px-4 font-mono text-right text-xs text-kumo-default">
                        {preBillingByUser
                          ? formatUsd4(preBillingUsd(preBillingByUser.get(user.username)
                              ?? { legacyUsd: 0, postLaunchChatUsd: 0 }))
                          : '—'}
                      </td>
                    )}
                    <td className="py-3 px-4 text-xs text-kumo-default" title={formatDateTime(user.lastActive)}>
                      {formatRelativeTime(user.lastActive)}
                    </td>
                    <td className="py-3 px-4 text-xs text-kumo-subtle">{formatDateTime(user.createdAt)}</td>
                    {billing && (
                      <td className="py-3 px-4">
                        <UserBillingCell billing={billing} userKey={user.username} range={range}
                          preBilling={preBillingByUser?.get(user.username)} />
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      {totalCount > PAGE_SIZE && (
        <Pagination className="mt-4" page={page} setPage={onPageChange} perPage={PAGE_SIZE}
          totalCount={totalCount} labels={PAGINATION_LABELS} />
      )}
    </>
  )
}
