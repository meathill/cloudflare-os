import type { BillingUsageSource } from '@gadgets/workshop-shared/billing'

/** 各计费来源的显示名。 */
export const SOURCE_LABELS: Record<BillingUsageSource, string> = {
  chat: '对话',
  compaction: '上下文压缩',
  'cache-warm': '缓存保温',
  title: '标题生成',
  'gadget-llm': 'Gadget 模型调用',
  'gadget-decision': 'Gadget 判定',
  'web-search': '联网搜索',
  memory: '后台整理',
}

/** 与计费 Worker 的 BILLABLE_SOURCES 保持一致：只有这些来源向用户扣费，其余由平台承担。 */
export const USER_BILLED_SOURCES: readonly BillingUsageSource[] = [
  'chat',
  'compaction',
  'cache-warm',
]
