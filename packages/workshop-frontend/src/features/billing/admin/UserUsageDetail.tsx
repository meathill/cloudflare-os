import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import { Banner, Button, Loader, Table } from '@cloudflare/kumo'
import type { BillingAdminClient } from '@gadgets/workshop-shared/api'
import type { BillingLedgerEntry, BillingUsageEvent, BillingUsageRange } from '@gadgets/workshop-shared/billing'
import { formatUsd4 } from '../formatUsd'
import { modelLabel } from '../modelLabel'
import { SOURCE_LABELS } from '../usageSources'
import { useUsageReport } from './useUsageReport'
import { LedgerEntriesTable } from './LedgerEntriesTable'
import { ModelUsageTable } from './UsageBreakdown'

const SectionTitle = ({ children }: { children: string }) => (
  <h3 className="mb-2 text-sm font-semibold text-kumo-default">{children}</h3>
)

const EVENT_PAGE_SIZE = 100

/** 某一北京日内一个用户的逐次扣费明细，按 id 游标向前翻页。 */
const UserUsageEvents = ({ api, userKey, initialDay }: {
  api: RpcStub<BillingAdminClient>
  userKey: string
  initialDay: string
}) => {
  const [day, setDay] = useState(initialDay)
  const [events, setEvents] = useState<BillingUsageEvent[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  useEffect(() => {
    let cancelled = false
    setEvents(null)
    api.listUsageEvents({ userKey, day, limit: EVENT_PAGE_SIZE }).then((rows) => {
      if (!cancelled) {
        setEvents(rows)
        setHasMore(rows.length === EVENT_PAGE_SIZE)
      }
    }).catch(() => { if (!cancelled) setEvents([]) })
    return () => { cancelled = true }
  }, [api, userKey, day])

  const loadMore = async () => {
    const last = events?.[events.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    try {
      const rows = await api.listUsageEvents({ userKey, day, before: last.id, limit: EVENT_PAGE_SIZE })
      setEvents((current) => [...(current ?? []), ...rows])
      setHasMore(rows.length === EVENT_PAGE_SIZE)
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-kumo-subtle">
        <span>日期</span>
        <input
          type="date"
          value={day}
          onChange={(e) => { if (e.target.value) setDay(e.target.value) }}
          aria-label="明细日期"
          className="rounded-md border border-kumo-line bg-kumo-base px-2 py-1 text-kumo-default [color-scheme:light] dark:[color-scheme:dark]"
        />
      </div>
      <div className="overflow-x-auto rounded-lg border border-kumo-line">
        {events === null ? (
          <div className="flex justify-center py-8"><Loader /></div>
        ) : (
          <Table>
            <Table.Header>
              <Table.Row>
                <Table.Head>时间</Table.Head>
                <Table.Head>来源</Table.Head>
                <Table.Head>模型</Table.Head>
                <Table.Head className="text-right">倍率</Table.Head>
                <Table.Head className="text-right">输入</Table.Head>
                <Table.Head className="text-right">输出</Table.Head>
                <Table.Head className="text-right">缓存读</Table.Head>
                <Table.Head className="text-right">缓存写</Table.Head>
                <Table.Head className="text-right">原始成本</Table.Head>
                <Table.Head className="text-right">扣费</Table.Head>
                <Table.Head className="text-right">对话</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {events.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={11} className="py-8 text-center text-kumo-subtle">
                    这一天没有明细。
                  </Table.Cell>
                </Table.Row>
              ) : events.map((event) => (
                <Table.Row key={event.id}>
                  <Table.Cell className="whitespace-nowrap text-xs">
                    {new Date(event.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
                  </Table.Cell>
                  <Table.Cell className="text-xs">{SOURCE_LABELS[event.source] ?? event.source}</Table.Cell>
                  <Table.Cell className="text-xs" title={event.model}>{modelLabel(event.model)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-xs">{event.markup}x</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-xs">{event.inputTokens.toLocaleString('zh-CN')}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-xs">{event.outputTokens.toLocaleString('zh-CN')}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-xs">{event.cacheReadTokens.toLocaleString('zh-CN')}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-xs">{event.cacheWriteTokens.toLocaleString('zh-CN')}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-xs">{formatUsd4(event.rawCostUsd)}</Table.Cell>
                  <Table.Cell className="text-right tabular-nums text-xs">{formatUsd4(event.chargedUsd)}</Table.Cell>
                  <Table.Cell className="text-right text-xs">{event.chatId ?? '—'}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        )}
      </div>
      {hasMore && (
        <div className="mt-2 flex justify-center">
          <Button size="sm" variant="secondary" loading={loadingMore} onClick={loadMore}>
            加载更多
          </Button>
        </div>
      )}
    </div>
  )
}

/** 弹窗下半部分：区间内按模型用量、流水、逐次明细。 */
export const UserUsageDetail = ({ api, userKey, range }: {
  api: RpcStub<BillingAdminClient>
  userKey: string
  range: BillingUsageRange
}) => {
  const { report, error } = useUsageReport(api, { ...range, userKey })
  const [ledger, setLedger] = useState<BillingLedgerEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    api.listLedger(userKey, 200).then(
      (rows) => { if (!cancelled) setLedger(rows) },
      () => { if (!cancelled) setLedger([]) },
    )
    return () => { cancelled = true }
  }, [api, userKey])

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>区间内按模型用量</SectionTitle>
        {error ? (
          <Banner variant="error" title={error} />
        ) : report === null ? (
          <div className="flex justify-center py-8"><Loader /></div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-kumo-line">
            <ModelUsageTable rows={report.byModel} />
          </div>
        )}
      </section>

      <section>
        <SectionTitle>流水</SectionTitle>
        <div className="overflow-x-auto rounded-lg border border-kumo-line">
          {ledger === null ? (
            <div className="flex justify-center py-8"><Loader /></div>
          ) : (
            <LedgerEntriesTable entries={ledger} showUser={false} />
          )}
        </div>
      </section>

      <section>
        <SectionTitle>逐次明细</SectionTitle>
        <UserUsageEvents api={api} userKey={userKey} initialDay={range.to} />
      </section>
    </div>
  )
}
