import { useState } from 'react'
import { Button, TagInput, useKumoToastManager } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AdminApi } from '@gadgets/workshop-shared/api'
import { rpcFailureDescription } from '../../rpcErrors'

/** The hosts `webFetch` may still reach once a workspace has observed restricted data. */
export const RestrictedWebFetchHostsCard = ({ admin, hosts, onSaved }: {
  admin: RpcStub<AdminApi>
  /** What the server holds. */
  hosts: string[]
  /** Receives the list as the server stored it. */
  onSaved: (hosts: string[]) => void
}) => {
  // The list being edited, or null while the field shows the server's list.
  const [draft, setDraft] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const toasts = useKumoToastManager()
  const changed = draft !== null && draft.join('\n') !== hosts.join('\n')

  const save = async () => {
    if (draft === null) return
    setSaving(true)
    try {
      onSaved(await admin.setRestrictedWebFetchHosts(draft))
      setDraft(null)
      toasts.add({ title: '可信主机已保存', variant: 'success' })
    } catch (err) {
      toasts.add({
        title: '保存可信主机失败',
        description: rpcFailureDescription(err),
        variant: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
      <h2 className="text-lg font-semibold text-kumo-strong mb-1">受限工作区中的网页获取</h2>
      <p className="text-sm text-kumo-subtle mb-5">
        工作区读取连接器标记为受限的数据后，其智能体只能从这些主机获取网页，且 URL 不能包含查询字符串。仅当所有能看到该主机请求的人（包括读取日志、分析数据、缓存和转发请求的接收方）都可以查看这些数据时，才添加该主机。未设置主机时，这些工作区无法获取网页。
      </p>

      <TagInput
        label="可信主机"
        description="填写完整主机名，例如 docs.example.com。子域名需要单独添加。"
        placeholder="docs.example.com"
        autoComplete="off"
        value={draft ?? hosts}
        onValueChange={setDraft}
        disabled={saving}
      />

      <div className="flex items-center justify-end gap-2 mt-3">
        {changed && (
          <Button variant="ghost" size="sm" onClick={() => setDraft(null)} disabled={saving}>
            重置
          </Button>
        )}
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!changed}>
          保存
        </Button>
      </div>
    </div>
  )
}
