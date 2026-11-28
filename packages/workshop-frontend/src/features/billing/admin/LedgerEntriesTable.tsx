import { Table } from '@cloudflare/kumo'
import type { BillingLedgerEntry, BillingLedgerKind } from '@gadgets/workshop-shared/billing'
import { formatUsd } from '../formatUsd'

export const LEDGER_KIND_LABELS: Record<BillingLedgerKind, string> = {
  topup: '充值',
  grant: '调整',
  refund: '退款',
  dispute: '争议',
  plan: '方案 / 倍率',
}

const formatLedgerAmount = (entry: BillingLedgerEntry) =>
  entry.kind === 'plan' ? '—' : formatUsd(entry.amountUsd)

/** 流水表；管理端单用户详情弹窗使用，单用户时不显示「用户」列。 */
export const LedgerEntriesTable = ({ entries, showUser }: {
  entries: BillingLedgerEntry[]
  showUser: boolean
}) => (
  // 与弹窗内其他表一致：压掉 Kumo Table 内置的 text-base（见 UsageBreakdown 的注释）。
  <Table className="text-sm! [&_th]:text-sm!">
    <Table.Header>
      <Table.Row>
        <Table.Head>时间</Table.Head>
        {showUser && <Table.Head>用户</Table.Head>}
        <Table.Head>类型</Table.Head>
        <Table.Head className="text-right">金额</Table.Head>
        <Table.Head>备注</Table.Head>
        <Table.Head>操作人</Table.Head>
      </Table.Row>
    </Table.Header>
    <Table.Body>
      {entries.length === 0 ? (
        <Table.Row>
          <Table.Cell colSpan={showUser ? 6 : 5} className="py-8 text-center text-kumo-subtle">
            这段时间没有流水。
          </Table.Cell>
        </Table.Row>
      ) : entries.map((entry) => (
        <Table.Row key={entry.id}>
          <Table.Cell className="whitespace-nowrap text-kumo-subtle">
            {new Date(entry.createdAt).toLocaleString('zh-CN')}
          </Table.Cell>
          {showUser && <Table.Cell>{entry.userKey}</Table.Cell>}
          <Table.Cell>{LEDGER_KIND_LABELS[entry.kind] ?? entry.kind}</Table.Cell>
          <Table.Cell className="text-right tabular-nums">{formatLedgerAmount(entry)}</Table.Cell>
          <Table.Cell className="max-w-48 truncate text-kumo-subtle" title={entry.note}>
            {entry.note}
          </Table.Cell>
          <Table.Cell className="text-kumo-subtle">{entry.actor}</Table.Cell>
        </Table.Row>
      ))}
    </Table.Body>
  </Table>
)
