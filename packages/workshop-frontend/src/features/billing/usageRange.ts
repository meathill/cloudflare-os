import type { BillingUsageRange } from '@gadgets/workshop-shared/billing'

/** 用量区间的预设选项。 */
export type UsagePreset = 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth'

/** 各预设的显示名。 */
export const USAGE_PRESET_LABELS: Record<UsagePreset, string> = {
  today: '今天',
  last7: '近 7 天',
  last30: '近 30 天',
  thisMonth: '本月',
  lastMonth: '上月',
}

const DAY_MS = 86_400_000

/** 与计费 Worker 的 beijingDay 一致：+8 小时后取 UTC 日，不依赖运行环境的时区。 */
export const beijingToday = (now = Date.now()): string =>
  new Date(now + 8 * 3_600_000).toISOString().slice(0, 10)

const shiftDay = (day: string, offsetDays: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + offsetDays * DAY_MS).toISOString().slice(0, 10)

/** 预设对应的北京日期区间（含两端）。 */
export const presetRange = (preset: UsagePreset, now = Date.now()): BillingUsageRange => {
  const today = beijingToday(now)
  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case 'last7':
      return { from: shiftDay(today, -6), to: today }
    case 'last30':
      return { from: shiftDay(today, -29), to: today }
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today }
    case 'lastMonth': {
      // 本月一号前一天是上月最后一天，天然处理跨年。
      const last = shiftDay(`${today.slice(0, 7)}-01`, -1)
      return { from: `${last.slice(0, 7)}-01`, to: last }
    }
  }
}

/** 合法区间：from 不晚于 to，跨度不超过 366 天（与服务端校验一致）。 */
export const isValidRange = (range: BillingUsageRange): boolean =>
  range.from <= range.to &&
  Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`) <= 365 * DAY_MS
