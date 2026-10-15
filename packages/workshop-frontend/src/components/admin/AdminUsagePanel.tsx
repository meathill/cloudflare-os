import { useState, useEffect, useMemo } from 'react'
import type { RpcStub } from 'capnweb'
import { Button, Input, useKumoToastManager } from '@cloudflare/kumo'
import {
  Users,
  Scroll,
  Lightning,
  ChatCircleDots,
  ArrowClockwise,
  SortAscending,
  SortDescending,
} from '@phosphor-icons/react'
import type { AdminApi, UsageStatsResponse } from '@gadgets/workshop-shared/api'

interface AdminUsagePanelProps {
  admin: RpcStub<AdminApi>
}

type SortField = 'lastActive' | 'totalTokens' | 'callCount' | 'workspaceCount' | 'createdAt'
type SortOrder = 'asc' | 'desc'

function formatDateTime(iso: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatRelativeTime(iso: string) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  const diffMs = Date.now() - d.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 60) return '刚刚'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} 分钟前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} 小时前`
  const diffDays = Math.floor(diffHour / 24)
  if (diffDays < 30) return `${diffDays} 天前`
  return formatDateTime(iso)
}

export default function AdminUsagePanel({ admin }: AdminUsagePanelProps) {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [data, setData] = useState<UsageStatsResponse | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('lastActive')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const toasts = useKumoToastManager()

  async function fetchUsage(isManual = false) {
    if (isManual) setRefreshing(true)
    try {
      const stats = await admin.getUsageStats()
      setData(stats)
      if (isManual) {
        toasts.add({ title: '用量数据已更新', variant: 'success' })
      }
    } catch (err) {
      console.error('Failed to load usage stats:', err)
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
  }, [admin])

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }

  const filteredUsers = useMemo(() => {
    if (!data?.users) return []
    let list = [...data.users]
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      list = list.filter(
        (u) =>
          u.username.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)
      )
    }
    list.sort((a, b) => {
      const valA = a[sortField]
      const valB = b[sortField]
      if (typeof valA === 'string') {
        const timeA = new Date(valA).getTime()
        const timeB = new Date(valB as string).getTime()
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA
      }
      return sortOrder === 'asc'
        ? (valA as number) - (valB as number)
        : (valB as number) - (valA as number)
    })
    return list
  }, [data?.users, searchQuery, sortField, sortOrder])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 bg-kumo-elevated border border-kumo-line rounded-xl">
        <ArrowClockwise size={24} className="animate-spin text-kumo-subtle mr-2" />
        <p className="text-sm text-kumo-subtle">正在加载全平台用量统计...</p>
      </div>
    )
  }

  const overview = data?.overview ?? {
    totalUsers: 0,
    totalWorkspaces: 0,
    totalTokens: 0,
    totalCost: 0,
    totalCalls: 0,
  }

  return (
    <div className="space-y-6">
      {/* 头部标题与刷新 */}
      <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-kumo-strong">用量统计与用户行为看板</h2>
            <p className="text-sm text-kumo-subtle mt-1">
              全平台用户的活跃行为、剧本/工作区数量以及模型调用 Token 消耗实时汇总。
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchUsage(true)}
            loading={refreshing}
            disabled={refreshing}
          >
            <ArrowClockwise size={16} className={`mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
            刷新数据
          </Button>
        </div>

        {/* 指标卡片网格 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <div className="bg-kumo-base border border-kumo-line rounded-lg p-4">
            <div className="flex items-center justify-between text-kumo-subtle">
              <span className="text-xs font-medium">总用户数</span>
              <Users size={18} className="text-kumo-brand" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-kumo-strong">
              {overview.totalUsers.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-kumo-subtle">全平台已注册/活跃用户</div>
          </div>

          <div className="bg-kumo-base border border-kumo-line rounded-lg p-4">
            <div className="flex items-center justify-between text-kumo-subtle">
              <span className="text-xs font-medium">剧本/工作区总数</span>
              <Scroll size={18} className="text-purple-500" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-kumo-strong">
              {overview.totalWorkspaces.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-kumo-subtle">用户累计创建的故事项目</div>
          </div>

          <div className="bg-kumo-base border border-kumo-line rounded-lg p-4">
            <div className="flex items-center justify-between text-kumo-subtle">
              <span className="text-xs font-medium">累计消耗 Tokens</span>
              <Lightning size={18} className="text-amber-500" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-kumo-strong">
              {overview.totalTokens.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-kumo-subtle">
              Gemini 3.8 Flash 输入与输出
            </div>
          </div>

          <div className="bg-kumo-base border border-kumo-line rounded-lg p-4">
            <div className="flex items-center justify-between text-kumo-subtle">
              <span className="text-xs font-medium">AI 对话轮次</span>
              <ChatCircleDots size={18} className="text-emerald-500" />
            </div>
            <div className="mt-2 text-2xl font-semibold text-kumo-strong">
              {overview.totalCalls.toLocaleString()}
            </div>
            <div className="mt-1 text-xs text-kumo-subtle">
              预估费用: ${overview.totalCost.toFixed(4)}
            </div>
          </div>
        </div>
      </div>

      {/* 用户明细列表 */}
      <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-kumo-strong">用户用量明细</h3>
            <p className="text-xs text-kumo-subtle mt-0.5">
              共统计到 {data?.users.length ?? 0} 位用户数据，按活跃度及用量展示。
            </p>
          </div>
          <div className="w-full sm:w-64">
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索用户名或昵称..."
            />
          </div>
        </div>

        {/* 表格 */}
        <div className="overflow-x-auto border border-kumo-line rounded-lg">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="bg-kumo-base/80 border-b border-kumo-line text-xs font-medium text-kumo-subtle select-none">
                <th className="py-3 px-4">用户</th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-kumo-strong transition-colors"
                  onClick={() => handleSort('workspaceCount')}
                >
                  <div className="flex items-center gap-1">
                    <span>剧本项目</span>
                    {sortField === 'workspaceCount' && (
                      sortOrder === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-kumo-strong transition-colors"
                  onClick={() => handleSort('callCount')}
                >
                  <div className="flex items-center gap-1">
                    <span>AI 会话轮次</span>
                    {sortField === 'callCount' && (
                      sortOrder === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-kumo-strong transition-colors"
                  onClick={() => handleSort('totalTokens')}
                >
                  <div className="flex items-center gap-1">
                    <span>消耗 Tokens</span>
                    {sortField === 'totalTokens' && (
                      sortOrder === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
                    )}
                  </div>
                </th>
                <th className="py-3 px-4">预估费用</th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-kumo-strong transition-colors"
                  onClick={() => handleSort('lastActive')}
                >
                  <div className="flex items-center gap-1">
                    <span>最后活跃</span>
                    {sortField === 'lastActive' && (
                      sortOrder === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
                    )}
                  </div>
                </th>
                <th
                  className="py-3 px-4 cursor-pointer hover:text-kumo-strong transition-colors"
                  onClick={() => handleSort('createdAt')}
                >
                  <div className="flex items-center gap-1">
                    <span>首次进入</span>
                    {sortField === 'createdAt' && (
                      sortOrder === 'asc' ? <SortAscending size={14} /> : <SortDescending size={14} />
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-kumo-line/60">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-kumo-subtle text-sm">
                    {searchQuery ? '没有找到符合条件的用户' : '暂无用户活动记录'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => (
                  <tr
                    key={user.username}
                    className="hover:bg-kumo-tint/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-kumo-tint flex items-center justify-center text-xs font-semibold text-kumo-strong border border-kumo-line flex-shrink-0">
                          {user.displayName.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium text-kumo-strong truncate">
                            {user.displayName}
                          </div>
                          <div className="text-xs text-kumo-subtle truncate">
                            {user.username}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-kumo-default">
                      {user.workspaceCount}
                    </td>
                    <td className="py-3 px-4 font-mono text-kumo-default">
                      {user.callCount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono font-medium text-amber-600 dark:text-amber-400">
                      {user.totalTokens.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-kumo-subtle">
                      ${user.estimatedCost.toFixed(4)}
                    </td>
                    <td className="py-3 px-4 text-xs text-kumo-default" title={formatDateTime(user.lastActive)}>
                      {formatRelativeTime(user.lastActive)}
                    </td>
                    <td className="py-3 px-4 text-xs text-kumo-subtle">
                      {formatDateTime(user.createdAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
