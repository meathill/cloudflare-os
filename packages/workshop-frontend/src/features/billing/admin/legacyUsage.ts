import type { BillingUsageReportQuery } from '@gadgets/workshop-shared/billing'

/** 计费 Worker 上线的北京日：usage_daily 从 2026-11-14 23:16（北京）起有数据。 */
export const BILLING_LAUNCH_DAY = '2026-11-14'

/** 旧统计（AdminSettings userUsage）停止累加成本与 Token 的北京日，之后由计费 Worker 负责。 */
export const LEGACY_COST_FROZEN_DAY = '2026-11-18'

/**
 * 「计费上线前（估算）」用的固定查询：上线日到旧统计冻结日，只看 chat 来源——
 * title / web-search 等也挂在用户名下，但旧统计只按对话成本估算。模块级常量
 * 保证引用稳定，不随选择器的时间范围变化。
 */
export const LEGACY_OVERLAP_QUERY: BillingUsageReportQuery = {
  from: BILLING_LAUNCH_DAY,
  to: LEGACY_COST_FROZEN_DAY,
  source: 'chat',
}

/** 「计费上线前（估算）」的两个输入：旧统计累计估算，与上线后同口径的对话原始成本。 */
export type PreBillingEstimate = { legacyUsd: number; postLaunchChatUsd: number }

/** 估算值：旧统计减去重叠期已计入计费库的对话成本，不为负。 */
export const preBillingUsd = ({ legacyUsd, postLaunchChatUsd }: PreBillingEstimate) =>
  Math.max(0, legacyUsd - postLaunchChatUsd)
