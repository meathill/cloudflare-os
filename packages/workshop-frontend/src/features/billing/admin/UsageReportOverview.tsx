import type { UsageOverviewStats } from '@gadgets/workshop-shared/api'
import type { BillingUsageReport } from '@gadgets/workshop-shared/billing'
import { formatUsd4 } from '../formatUsd'
import { preBillingUsd, type PreBillingEstimate } from './legacyUsage'

/** 充值到账统计进报表的流水类型。 */
const TOPUP_KINDS = new Set(['topup', 'refund', 'dispute'])

const MetricCard = ({ label, value, detail }: {
  label: string
  value: string
  detail?: string
}) => (
  <div className="bg-kumo-base border border-kumo-line rounded-lg p-4">
    <span className="text-xs font-medium text-kumo-subtle">{label}</span>
    <div className="mt-2 text-2xl font-semibold text-kumo-strong tabular-nums">{value}</div>
    {detail && <div className="mt-1 text-xs text-kumo-subtle">{detail}</div>}
  </div>
)

/** 区间计费报表的汇总指标卡：行为数据（用户/工作区数）+ 计费精确数据。 */
export const UsageReportOverview = ({ report, stats, preBilling }: {
  report: BillingUsageReport
  stats: UsageOverviewStats | null
  /** 计费上线前的估算数据；undefined 时隐藏该卡。 */
  preBilling?: PreBillingEstimate
}) => {
  const totals = report.totals
  const totalTokens = totals.inputTokens + totals.outputTokens
    + totals.cacheReadTokens + totals.cacheWriteTokens
  const topups = report.ledger.filter((row) => TOPUP_KINDS.has(row.kind))
  const topupUsd = topups.reduce((sum, row) => sum + row.amountUsd, 0)
  const topupCount = topups.reduce((sum, row) => sum + row.count, 0)
  // 毛利口径：用户扣费减去「收费请求」的原始成本，平台承担的成本不算进毛利分母。
  const grossUsd = totals.chargedUsd - (totals.rawCostUsd - totals.platformCostUsd)
  const preBillingValue = preBilling ? preBillingUsd(preBilling) : 0

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="用户数"
          value={(stats?.totalUsers ?? 0).toLocaleString('zh-CN')}
          detail="全平台已注册/活跃用户"
        />
        <MetricCard
          label="剧本/工作区数"
          value={(stats?.totalWorkspaces ?? 0).toLocaleString('zh-CN')}
          detail="用户累计创建的故事项目"
        />
        <MetricCard
          label="请求数"
          value={totals.requests.toLocaleString('zh-CN')}
          detail="区间内全部计费来源合计"
        />
        <MetricCard
          label="Tokens（实际）"
          value={totalTokens.toLocaleString('zh-CN')}
          detail={`输入 ${totals.inputTokens.toLocaleString('zh-CN')} · 输出 ${totals.outputTokens.toLocaleString('zh-CN')} · 缓存读 ${totals.cacheReadTokens.toLocaleString('zh-CN')} · 缓存写 ${totals.cacheWriteTokens.toLocaleString('zh-CN')}`}
        />
        <MetricCard
          label="原始成本"
          value={formatUsd4(totals.rawCostUsd)}
          detail="按各模型官方单价核算（总开销）"
        />
        <MetricCard
          label="平台承担"
          value={formatUsd4(totals.platformCostUsd)}
          detail="内部 / 0x 用户与平台来源，不向用户收费"
        />
        <MetricCard
          label="用户扣费"
          value={formatUsd4(totals.chargedUsd)}
          detail="区间内从余额扣出"
        />
        <MetricCard
          label="毛利"
          value={formatUsd4(grossUsd)}
          detail="用户扣费 − 收费请求的原始成本"
        />
        {preBilling && (
          <MetricCard
            label="计费上线前（估算）"
            value={formatUsd4(preBillingValue)}
            detail={`旧统计累计 ${formatUsd4(preBilling.legacyUsd)}，减去计费上线后对话成本 ${formatUsd4(preBilling.postLaunchChatUsd)}；按 Token 估算，不随时间范围变化`}
          />
        )}
        <MetricCard
          label="充值到账"
          value={formatUsd4(topupUsd)}
          detail={`${topupCount} 笔充值 / 退款 / 争议流水`}
        />
      </div>
      <p className="mt-4 text-xs text-kumo-subtle">
        原始成本按各模型官方单价核算；对话、上下文压缩、缓存保温按个人倍率向用户扣费，其余由平台承担。日期按北京时间。
      </p>
    </div>
  )
}
