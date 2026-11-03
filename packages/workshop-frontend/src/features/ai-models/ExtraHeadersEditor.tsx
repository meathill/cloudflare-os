import { Button, Input } from '@cloudflare/kumo'
import { Plus, Trash } from '@phosphor-icons/react'
import { canKeepStoredValue, newHeaderRow, type HeaderRow } from './extraHeaders'
import { StoredSecretInput } from './StoredSecretInput'

export const ExtraHeadersEditor = ({ rows, errors, onRowsChange, storedValuesUsable }: {
  rows: readonly HeaderRow[]
  /** Whether stored values may still be kept, which the server allows only for the same endpoint. */
  storedValuesUsable: boolean
  errors: Readonly<Record<number, string>>
  onRowsChange: (rows: HeaderRow[]) => void
}) => {
  const updateRow = (id: number, patch: Partial<Omit<HeaderRow, 'id'>>) =>
    onRowsChange(rows.map(row => {
      if (row.id !== id) return row
      const updated = { ...row, ...patch }
      // The stored value belongs to the stored name, so a renamed header needs a new value.
      return updated.value === null && !canKeepStoredValue(updated) ? { ...updated, value: '' } : updated
    }))

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-base font-medium text-kumo-default">额外请求头</legend>
      <p className="text-sm leading-snug text-kumo-subtle">
        随每次请求发送给服务商，覆盖同名默认请求头
      </p>
      {rows.map(row => (
        <div key={row.id} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <Input
              aria-label="请求头名称"
              placeholder="请求头名称"
              value={row.name}
              onChange={(e) => updateRow(row.id, { name: e.target.value })}
              error={errors[row.id]}
            />
          </div>
          <div className="min-w-0 flex-1">
            <StoredSecretInput
              aria-label="请求头值"
              placeholder="值"
              stored={storedValuesUsable && canKeepStoredValue(row)}
              value={row.value}
              onValueChange={(value) => updateRow(row.id, { value })}
            />
          </div>
          <Button
            variant="ghost"
            shape="square"
            icon={Trash}
            aria-label="移除请求头"
            onClick={() => onRowsChange(rows.filter(r => r.id !== row.id))}
          />
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          icon={Plus}
          onClick={() => onRowsChange([...rows, newHeaderRow()])}
        >
          添加请求头
        </Button>
      </div>
    </fieldset>
  )
}
