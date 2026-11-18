import { useCallback, useEffect, useRef, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { BillingAdminClient } from '@gadgets/workshop-shared/api'
import type { BillingUsageRange, BillingUsageReport } from '@gadgets/workshop-shared/billing'

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : '加载计费报表失败'

/**
 * 按区间（可选限定单用户）拉取计费用量报表。依赖变化后丢弃过期响应，
 * 保证慢请求回得晚也不会覆盖新结果。
 */
export const useUsageReport = (
  api: RpcStub<BillingAdminClient> | undefined,
  range: BillingUsageRange,
  userKey?: string,
) => {
  const [report, setReport] = useState<BillingUsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const version = useRef(0)

  const reload = useCallback(() => {
    // api 未就绪时什么都不做：这可能是旧渲染闭包里的 reload，递增版本号或清空状态
    // 都会作废新闭包已经发出的请求或已经拿到的报表。
    if (!api) return
    const current = ++version.current
    const query = userKey ? { ...range, userKey } : range
    api.getUsageReport(query).then(
      (result) => {
        if (current === version.current) {
          setReport(result)
          setError(null)
        }
      },
      (err) => {
        if (current === version.current) {
          setReport(null)
          setError(errorMessage(err))
        }
      },
    )
    // range 是每次渲染新建的对象，按字段依赖即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, range.from, range.to, userKey])

  useEffect(() => {
    reload()
    return () => {
      version.current += 1
    }
  }, [reload])

  return { report, error, reload }
}
