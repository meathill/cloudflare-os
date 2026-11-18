import { describe, expect, it } from 'vitest'
import { SUGGESTED_MODELS } from '@gadgets/workshop-shared/api'
import { modelLabel } from './modelLabel'

describe('modelLabel', () => {
  it('已知模型解析为目录显示名', () => {
    const [provider, rest] = Object.entries(SUGGESTED_MODELS).find(([, m]) => Object.keys(m).length > 0)!
    const id = Object.keys(rest)[0]
    expect(modelLabel(`${provider}/${id}`)).toBe(rest[id].name)
  })

  it('google/gemini-4-hydrogen 显示为 Gemini 4 Hydrogen', () => {
    expect(modelLabel('google/gemini-4-hydrogen')).toBe('Gemini 4 Hydrogen')
  })

  it('未知 provider / 未知模型原样返回', () => {
    expect(modelLabel('unknown/foo-bar')).toBe('unknown/foo-bar')
    expect(modelLabel('google/not-a-model')).toBe('google/not-a-model')
    expect(modelLabel('custom-model')).toBe('custom-model')
  })

  it('特殊值：空字符串与联网搜索', () => {
    expect(modelLabel('')).toBe('未记录（升级前）')
    expect(modelLabel('web-search')).toBe('联网搜索')
  })

  it('provider 前缀含 / 时按第一个 / 拆分', () => {
    // "a/b/c" 拆成 provider=a、id=b/c，找不到时原样返回。
    expect(modelLabel('a/b/c')).toBe('a/b/c')
  })
})
