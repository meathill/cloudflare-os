import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import { Loader } from '@cloudflare/kumo'
import type { BillingUserApi, BillingUserUsageRow } from '@gadgets/workshop-shared/billing'
import { formatUsd } from '../../features/billing/formatUsd'
import { modelLabel } from '../../features/billing/modelLabel'
import { presetRange } from '../../features/billing/usageRange'
import { UsageRangePicker } from '../../features/billing/UsageRangePicker'

const num = (n: number) => n.toLocaleString('zh-CN')

type DayGroup = { day: string; rows: BillingUserUsageRow[]; chargedUsd: number; requests: number }

const groupByDay = (usage: BillingUserUsageRow[]): DayGroup[] => {
  const days = new Map<string, DayGroup>()
  for (const row of usage) {
    const group = days.get(row.day) ?? { day: row.day, rows: [], chargedUsd: 0, requests: 0 }
    group.rows.push(row)
    group.chargedUsd += row.chargedUsd
    group.requests += row.requests
    days.set(row.day, group)
  }
  // 新到旧。
  return [...days.values()].toSorted((a, b) => (a.day < b.day ? 1 : -1))
}

const TokenCell = ({ label, value }: { label: string; value: number }) => (
  <div className="flex flex-col items-end">
    <span className="text-[11px] leading-4 text-kumo-subtle">{label}</span>
    <span className="text-xs tabular-nums text-kumo-default">{num(value)}</span>
  </div>
)

/**
 * 用户自己的用量：按北京日 × 模型分组，只展示计费 Token 与扣费，
 * 不暴露倍率或原始成本（见 BillingUserUsageRow 的契约注释）。
 */
export const BillingUsageSection = ({ api }: { api: RpcStub<BillingUserApi> }) => {
  const [range, setRange] = useState(() => presetRange('last30'))
  const [usage, setUsage] = useState<BillingUserUsageRow[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getUsage(range).then(
      (rows) => { if (!cancelled) setUsage(rows) },
      () => { if (!cancelled) setUsage([]) },
    )
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, range.from, range.to])

  const days = usage === null ? [] : groupByDay(usage)
  const totalCharged = days.reduce((sum, day) => sum + day.chargedUsd, 0)
  const totalRequests = days.reduce((sum, day) => sum + day.requests, 0)

  return (
    <div className="flex flex-col gap-3">
      <UsageRangePicker value={range} onValueChange={setRange} />
      {usage !== null && usage.length > 0 && (
        <p className="px-1 text-xs text-kumo-subtle">
          区间合计：扣费 {formatUsd(totalCharged)} · {num(totalRequests)} 次请求
        </p>
      )}
      <div className="rounded-xl border border-kumo-line bg-kumo-base">
        {usage === null ? (
          <div className="p-5"><Loader size="base" /></div>
        ) : days.length === 0 ? (
          <p className="p-5 text-sm text-kumo-subtle">这段时间没有用量。</p>
        ) : (
          <ul className="divide-y divide-kumo-line">
            {days.map((day) => (
              <li key={day.day}>
                <div className="flex items-center justify-between px-5 pt-3 text-sm">
                  <span className="font-medium text-kumo-default">{day.day}</span>
                  <span className="font-medium text-kumo-default">{formatUsd(day.chargedUsd)}</span>
                </div>
                <ul className="divide-y divide-kumo-line/50">
                  {day.rows.map((row) => (
                    <li key={`${day.day}:${row.model}`}
                      className="flex items-center justify-between gap-4 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate text-kumo-default">
                        {modelLabel(row.model)}
                        <span className="ml-2 text-xs text-kumo-subtle">{num(row.requests)} 次</span>
                      </span>
                      <div className="flex items-center gap-4">
                        <TokenCell label="输入" value={row.inputTokens} />
                        <TokenCell label="输出" value={row.outputTokens} />
                        <TokenCell label="缓存读" value={row.cacheReadTokens} />
                        <TokenCell label="缓存写" value={row.cacheWriteTokens} />
                        <span className="w-20 text-right font-medium tabular-nums text-kumo-default">
                          {formatUsd(row.chargedUsd)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
