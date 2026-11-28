import { SUGGESTED_MODELS, type AiModelProvider } from '@gadgets/workshop-shared/api'

const KNOWN_LABELS: Record<string, string> = {
  '': '未记录（升级前）',
  'web-search': '联网搜索',
}

/** `${provider}/${modelId}` → 显示名；未知或不带 provider 的值原样返回，避免隐藏历史数据。 */
export const modelLabel = (model: string): string => {
  const known = KNOWN_LABELS[model]
  if (known !== undefined) return known
  const slash = model.indexOf('/')
  if (slash > 0) {
    const provider = model.slice(0, slash) as AiModelProvider
    const name = SUGGESTED_MODELS[provider]?.[model.slice(slash + 1)]?.name
    if (name) return name
  }
  return model
}
