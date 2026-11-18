import type { BillingUsageRange } from '@gadgets/workshop-shared/billing'

/** 计费 Worker 上线的北京日：usage_daily 从 2026-11-14 23:16（北京）起有数据。 */
export const BILLING_LAUNCH_DAY = '2026-11-14'

/** 旧统计（AdminSettings userUsage）停止累加成本与 Token 的北京日，之后由计费 Worker 负责。 */
export const LEGACY_COST_FROZEN_DAY = '2026-11-18'

/**
 * 「计费上线前（估算）」卡用的固定区间：上线日到旧统计冻结日。
 * 模块级常量保证引用稳定，不随选择器的时间范围变化。
 */
export const LEGACY_OVERLAP_RANGE: BillingUsageRange = {
  from: BILLING_LAUNCH_DAY,
  to: LEGACY_COST_FROZEN_DAY,
}
