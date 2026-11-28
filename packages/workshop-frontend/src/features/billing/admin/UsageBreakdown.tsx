import { useState } from 'react'
import { Badge, Table, Tabs } from '@cloudflare/kumo'
import type { BillingUsageReport, BillingUsageTotals } from '@gadgets/workshop-shared/billing'
import { modelLabel } from '../modelLabel'
import { SOURCE_LABELS, USER_BILLED_SOURCES } from '../usageSources'
import { formatUsd4 } from '../formatUsd'

const num = (n: number) => n.toLocaleString('zh-CN')
const tokenTotal = (row: BillingUsageTotals) =>
  row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheWriteTokens

type ModelRow = BillingUsageTotals & { model: string }
type BreakdownTab = 'model' | 'source' | 'day'

const EMPTY = <Table.Row><Table.Cell colSpan={8} className="py-8 text-center text-kumo-subtle">这个区间没有用量。</Table.Cell></Table.Row>

/** 按模型的用量表；管理员在报表区和单用户弹窗里复用。 */
export const ModelUsageTable = ({ rows }: { rows: ModelRow[] }) => (
  // Kumo Table 的根内置 text-base 且 [&_th]:text-base 优先级更高，用 ! 压成弹窗内的紧凑字号。
  <Table className="text-sm! [&_th]:text-sm!">
    <Table.Header>
      <Table.Row>
        <Table.Head>模型</Table.Head>
        <Table.Head className="text-right">请求</Table.Head>
        <Table.Head className="text-right">输入</Table.Head>
        <Table.Head className="text-right">输出</Table.Head>
        <Table.Head className="text-right">缓存读</Table.Head>
        <Table.Head className="text-right">缓存写</Table.Head>
        <Table.Head className="text-right">原始成本</Table.Head>
        <Table.Head className="text-right">扣费</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {rows.length === 0 ? EMPTY : rows.map((row) => (
        <Table.Row key={row.model}>
          <Table.Cell>
            <div className="font-medium text-kumo-default">{modelLabel(row.model)}</div>
            {modelLabel(row.model) !== row.model && (
              <div className="text-xs text-kumo-subtle">{row.model}</div>
            )}
          </Table.Cell>
          <Table.Cell className="text-right tabular-nums">{num(row.requests)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{num(row.inputTokens)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{num(row.outputTokens)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{num(row.cacheReadTokens)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{num(row.cacheWriteTokens)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{formatUsd4(row.rawCostUsd)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{formatUsd4(row.chargedUsd)}</Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table>
)

const SourceTable = ({ rows }: { rows: BillingUsageReport['bySource'] }) => (
  <Table className="text-sm! [&_th]:text-sm!">
    <Table.Header>
      <Table.Row>
        <Table.Head>来源</Table.Head>
        <Table.Head className="text-right">请求</Table.Head>
        <Table.Head className="text-right">Tokens</Table.Head>
        <Table.Head className="text-right">原始成本</Table.Head>
        <Table.Head className="text-right">扣费</Table.Head>
        <Table.Head className="text-right">平台承担</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {rows.length === 0 ? EMPTY : rows.map((row) => (
        <Table.Row key={row.source}>
          <Table.Cell>
            <div className="flex items-center gap-2">
              <span className="font-medium text-kumo-default">{SOURCE_LABELS[row.source] ?? row.source}</span>
              <Badge variant={USER_BILLED_SOURCES.includes(row.source) ? 'success' : 'neutral'}>
                {USER_BILLED_SOURCES.includes(row.source) ? '向用户收费' : '平台承担'}
              </Badge>
            </div>
          </Table.Cell>
          <Table.Cell className="text-right tabular-nums">{num(row.requests)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{num(tokenTotal(row))}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{formatUsd4(row.rawCostUsd)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{formatUsd4(row.chargedUsd)}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{formatUsd4(row.platformCostUsd)}</Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table>
)

const DayTable = ({ rows }: { rows: BillingUsageReport['byDay'] }) => {
  const maxRaw = Math.max(...rows.map((row) => row.rawCostUsd), 0)
  return (
    <Table className="text-sm! [&_th]:text-sm!">
      <Table.Header>
        <Table.Row>
          <Table.Head>日期</Table.Head>
          <Table.Head className="w-1/3">成本趋势</Table.Head>
          <Table.Head className="text-right">请求</Table.Head>
          <Table.Head className="text-right">Tokens</Table.Head>
          <Table.Head className="text-right">原始成本</Table.Head>
          <Table.Head className="text-right">扣费</Table.Head>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.length === 0 ? EMPTY : rows.map((row) => (
          <Table.Row key={row.day}>
            <Table.Cell className="font-medium text-kumo-default">{row.day}</Table.Cell>
            <Table.Cell>
              <div className="h-1.5 rounded-full bg-kumo-tint">
                <div
                  className="h-1.5 rounded-full bg-kumo-brand"
                  style={{ width: `${maxRaw > 0 ? Math.max((row.rawCostUsd / maxRaw) * 100, 2) : 0}%` }}
                />
              </div>
            </Table.Cell>
            <Table.Cell className="text-right tabular-nums">{num(row.requests)}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{num(tokenTotal(row))}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{formatUsd4(row.rawCostUsd)}</Table.Cell>
            <Table.Cell className="text-right tabular-nums">{formatUsd4(row.chargedUsd)}</Table.Cell>
          </Table.Row>
        ))}
      </Table.Body>
    </Table>
  )
}

/** 区间用量的三种分组视角：按模型 / 按来源 / 按北京日。 */
export const UsageBreakdown = ({ report }: { report: BillingUsageReport }) => {
  const [tab, setTab] = useState<BreakdownTab>('model')
  return (
    <div>
      <Tabs
        size="sm"
        variant="segmented"
        value={tab}
        onValueChange={(value) => setTab(value as BreakdownTab)}
        tabs={[
          { value: 'model', label: '按模型' },
          { value: 'source', label: '按来源' },
          { value: 'day', label: '按天' },
        ]}
      />
      <div className="mt-3 overflow-x-auto rounded-lg border border-kumo-line">
        {tab === 'model' && <ModelUsageTable rows={report.byModel} />}
        {tab === 'source' && <SourceTable rows={report.bySource} />}
        {tab === 'day' && <DayTable rows={report.byDay} />}
      </div>
    </div>
  )
}
