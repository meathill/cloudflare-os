import { describe, expect, it } from 'vitest'
import { formatFullTimestamp } from './formatTimestamp'

describe('formatFullTimestamp', () => {
  it('使用中文日期格式并保留本地时区', () => {
    const date = new Date('2026-11-03T10:15:00Z')
    const expected = new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(date)
    expect(formatFullTimestamp(date)).toBe(expected)
  })
})
