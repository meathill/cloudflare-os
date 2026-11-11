import { useState } from 'react'
import { Button, Switch, TagInput, useKumoToastManager } from '@cloudflare/kumo'
import type { RpcStub } from 'capnweb'
import type { AdminApi } from '@gadgets/workshop-shared/api'
import { rpcFailureDescription } from '../../rpcErrors'

/** What `webFetch` may still reach once a workspace has observed restricted data. */
export const RestrictedWebFetchCard = ({ admin, hosts, onSaved, approvals, onApprovalsSaved }: {
  admin: RpcStub<AdminApi>
  /** What the server holds. */
  hosts: string[]
  /** Receives the list as the server stored it. */
  onSaved: (hosts: string[]) => void
  /** Whether users may approve other URLs, as the server holds it. */
  approvals: boolean
  onApprovalsSaved: (enabled: boolean) => void
}) => {
  // The list being edited, or null while the field shows the server's list.
  const [draft, setDraft] = useState<string[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingApprovals, setSavingApprovals] = useState(false)
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

  const saveApprovals = async (enabled: boolean) => {
    setSavingApprovals(true)
    try {
      await admin.setRestrictedWebFetchApprovals(enabled)
      onApprovalsSaved(enabled)
    } catch (err) {
      toasts.add({
        title: 'Failed to save the approval setting',
        description: rpcFailureDescription(err),
        variant: 'error',
      })
    } finally {
      setSavingApprovals(false)
    }
  }

  return (
    <div className="bg-kumo-elevated border border-kumo-line rounded-xl p-6">
      <h2 className="text-lg font-semibold text-kumo-strong mb-1">受限工作区中的网页获取</h2>
      <p className="text-sm text-kumo-subtle mb-5">
        一旦工作区读取了连接器标记为受限的数据，其智能体只能从这些主机获取网页，且 URL 不能包含查询字符串。只有所有能看到发往该主机的请求的人（包括读取其日志、分析数据和缓存的人，以及它转发请求的任何接收方）都能查看这些数据时，才添加该主机。
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

      <div className="flex items-center gap-4 mt-5 pt-5 border-t border-kumo-line">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-kumo-strong">Let users approve other URLs</p>
          <p className="text-sm text-kumo-subtle mt-0.5">
            The agent asks before fetching any other URL, and the user who approves it vouches that
            the URL holds none of that data. People approve most prompts they see, so leave this off
            unless users need pages you can&rsquo;t list. With it off and no hosts, those workspaces
            can&rsquo;t fetch at all.
          </p>
        </div>
        <Switch
          aria-label="Let users approve other URLs"
          checked={approvals}
          disabled={savingApprovals}
          onCheckedChange={enabled => void saveApprovals(enabled)}
        />
      </div>
    </div>
  )
}
