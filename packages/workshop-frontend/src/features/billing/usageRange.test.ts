import { describe, expect, it } from 'vitest'
import { beijingToday, isValidRange, presetRange, USAGE_PRESET_LABELS } from './usageRange'

// 2026-01-15T04:00:00Z = 北京 2026-01-15 12:00。
const NOON = Date.parse('2026-01-15T04:00:00Z')

describe('beijingToday', () => {
  it('UTC 16:00 之前算北京当天', () => {
    expect(beijingToday(NOON)).toBe('2026-01-15')
    expect(beijingToday(Date.parse('2026-01-15T15:59:59Z'))).toBe('2026-01-15')
  })

  it('UTC 16:00 之后算北京次日', () => {
    expect(beijingToday(Date.parse('2026-01-15T16:00:00Z'))).toBe('2026-01-16')
    expect(beijingToday(Date.parse('2026-01-15T20:00:00Z'))).toBe('2026-01-16')
  })

  it('跨年边界：UTC 12-31 16:00 已是北京次年 01-01', () => {
    expect(beijingToday(Date.parse('2025-12-31T16:00:00Z'))).toBe('2026-01-01')
  })
})

describe('presetRange', () => {
  it('today 只有一天', () => {
    expect(presetRange('today', NOON)).toEqual({ from: '2026-01-15', to: '2026-01-15' })
  })

  it('近 7 天 = 今天往前 6 天，跨月也正确', () => {
    expect(presetRange('last7', NOON)).toEqual({ from: '2026-01-09', to: '2026-01-15' })
    // 2 月 2 日的近 7 天跨进 1 月。
    expect(presetRange('last7', Date.parse('2026-02-02T04:00:00Z'))).toEqual({
      from: '2026-01-27',
      to: '2026-02-02',
    })
  })

  it('近 30 天 = 今天往前 29 天，跨年也正确', () => {
    expect(presetRange('last30', NOON)).toEqual({ from: '2025-12-17', to: '2026-01-15' })
  })

  it('本月 = 当月 1 号到今天', () => {
    expect(presetRange('thisMonth', NOON)).toEqual({ from: '2026-01-01', to: '2026-01-15' })
    // 1 号当天本月只有一天。
    expect(presetRange('thisMonth', Date.parse('2026-03-01T04:00:00Z'))).toEqual({
      from: '2026-03-01',
      to: '2026-03-01',
    })
  })

  it('上月 = 上一个自然月整月', () => {
    expect(presetRange('lastMonth', NOON)).toEqual({ from: '2025-12-01', to: '2025-12-31' })
    // 3 月的上月是 2 月，天数正确。
    expect(presetRange('lastMonth', Date.parse('2026-03-10T04:00:00Z'))).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    })
  })
})

describe('isValidRange', () => {
  it('接受同一天与正常区间', () => {
    expect(isValidRange({ from: '2026-01-01', to: '2026-01-01' })).toBe(true)
    expect(isValidRange({ from: '2026-01-01', to: '2026-01-31' })).toBe(true)
  })

  it('拒绝 from > to', () => {
    expect(isValidRange({ from: '2026-02-01', to: '2026-01-01' })).toBe(false)
  })

  it('跨度上限 366 天', () => {
    // 2025-01-01 至 2026-01-01 恰好 366 天。
    expect(isValidRange({ from: '2025-01-01', to: '2026-01-01' })).toBe(true)
    expect(isValidRange({ from: '2025-01-01', to: '2026-01-02' })).toBe(false)
  })
})

describe('USAGE_PRESET_LABELS', () => {
  it('覆盖全部预设', () => {
    expect(Object.keys(USAGE_PRESET_LABELS).toSorted()).toEqual(
      ['last7', 'last30', 'lastMonth', 'thisMonth', 'today'].toSorted(),
    )
  })
})
