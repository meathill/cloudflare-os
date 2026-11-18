import { useState } from 'react'
import type { BillingUsageRange } from '@gadgets/workshop-shared/billing'
import { isValidRange, presetRange, USAGE_PRESET_LABELS, type UsagePreset } from './usageRange'

const PRESETS = Object.keys(USAGE_PRESET_LABELS) as UsagePreset[]

const isDay = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

const isCommittable = (range: BillingUsageRange) =>
  isDay(range.from) && isDay(range.to) && range.from <= range.to && isValidRange(range)

const DATE_INPUT_CLASS =
  'rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-kumo-default ' +
  '[color-scheme:light] dark:[color-scheme:dark]'

/**
 * 北京日期区间选择器：预设 + 自定义起止。受控组件——合法区间立即回调，
 * 编辑中的非法草稿留在本地并提示，不回传。
 */
export const UsageRangePicker = ({ value, onValueChange }: {
  value: BillingUsageRange
  onValueChange: (range: BillingUsageRange) => void
}) => {
  const [draft, setDraft] = useState<BillingUsageRange | null>(null)
  const shown = draft ?? value

  const commit = (next: BillingUsageRange) => {
    if (isCommittable(next)) {
      setDraft(null)
      onValueChange(next)
    } else {
      setDraft(next)
    }
  }

  const activePreset = PRESETS.find((preset) => {
    const range = presetRange(preset)
    return range.from === value.from && range.to === value.to
  })

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex rounded-lg border border-kumo-line bg-kumo-elevated p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => {
              setDraft(null)
              onValueChange(presetRange(preset))
            }}
            className={[
              'rounded-md px-3 py-1 text-xs font-medium transition-colors',
              activePreset === preset && draft === null
                ? 'bg-kumo-base text-kumo-default shadow-sm'
                : 'text-kumo-subtle hover:text-kumo-default',
            ].join(' ')}
          >
            {USAGE_PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-kumo-subtle">
        <input
          type="date"
          aria-label="开始日期"
          value={shown.from}
          max={shown.to}
          onChange={(e) => commit({ from: e.target.value, to: shown.to })}
          className={DATE_INPUT_CLASS}
        />
        <span>至</span>
        <input
          type="date"
          aria-label="结束日期"
          value={shown.to}
          min={shown.from}
          onChange={(e) => commit({ from: shown.from, to: e.target.value })}
          className={DATE_INPUT_CLASS}
        />
      </div>
      {draft !== null && (
        <span className="text-xs text-kumo-danger">日期区间无效：需不晚于结束日期，跨度不超过 366 天</span>
      )}
    </div>
  )
}
