import { useEffect, useState } from 'react'
import { Badge, Button, useKumoToastManager } from '@cloudflare/kumo'
import type { OwnEmails } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../../AuthContext'
import { AddEmailForm } from './AddEmailForm'

type AccountEmailsProps = {
  commitEmail?: string
}

/**
 * The emails the account holds, each one proven by a code and held by this account alone. The
 * commit email is chosen among them, and a deployment admin is an account that holds an admin's.
 */
export const AccountEmails = ({ commitEmail: initialCommitEmail }: AccountEmailsProps) => {
  const { authenticatedApi } = useAuthenticatedApi()
  const toasts = useKumoToastManager()
  const [owned, setOwned] = useState<OwnEmails | null>(null)
  const [commitEmail, setCommitEmail] = useState(initialCommitEmail?.toLowerCase())
  const [isAdding, setIsAdding] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  useEffect(() => {
    let current = true
    authenticatedApi.getOwnEmails().then(
      (emails) => { if (current) setOwned(emails) },
      (err) => console.error('Failed to load emails:', err),
    )
    return () => { current = false }
  }, [authenticatedApi])

  const handleAdded = async () => {
    setIsAdding(false)
    setOwned(await authenticatedApi.getOwnEmails())
    toasts.add({ title: '邮箱已验证并添加', variant: 'success' })
  }

  const handleCommitEmail = async (email: string | null) => {
    setIsBusy(true)
    try {
      await authenticatedApi.setOwnCommitEmail(email)
      setCommitEmail(email ?? undefined)
      toasts.add({ title: email ? '提交邮箱已更新' : '提交邮箱已清除', variant: 'success' })
    } catch (err) {
      toasts.add({ title: err instanceof Error ? err.message : '更新提交邮箱失败', variant: 'error' })
    } finally {
      setIsBusy(false)
    }
  }

  const handleRemove = async (email: string) => {
    setIsBusy(true)
    try {
      await authenticatedApi.removeOwnEmail(email)
      setOwned(await authenticatedApi.getOwnEmails())
      if (commitEmail === email) setCommitEmail(undefined)
    } catch (err) {
      toasts.add({ title: err instanceof Error ? err.message : '移除邮箱失败', variant: 'error' })
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="px-5 py-4">
      <p className="text-[12px] font-medium tracking-[-0.1px] text-kumo-subtle">邮箱</p>
      {owned && owned.emails.length === 0 && (
        <p className="mt-1 text-[14px] tracking-[-0.25px] text-kumo-inactive">
          还没有验证过的邮箱
        </p>
      )}
      <ul className="mt-1.5 space-y-2">
        {owned?.emails.map((email) => (
          <li key={email} className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[14px] tracking-[-0.25px] text-kumo-default">
              {email}
            </span>
            {email === owned.loginEmail && <Badge variant="neutral">登录邮箱</Badge>}
            {email === commitEmail && <Badge variant="info">提交邮箱</Badge>}
            <span className="flex-1" />
            <Button
              size="sm"
              variant="ghost"
              disabled={isBusy}
              onClick={() => handleCommitEmail(email === commitEmail ? null : email)}
            >
              {email === commitEmail ? '不再用于提交' : '用于提交'}
            </Button>
            {email !== owned.loginEmail && (
              <Button
                size="sm"
                variant="ghost"
                disabled={isBusy}
                onClick={() => handleRemove(email)}
                aria-label={`移除 ${email}`}
              >
                移除
              </Button>
            )}
          </li>
        ))}
      </ul>
      {isAdding ? (
        <AddEmailForm onAdded={handleAdded} onCancel={() => setIsAdding(false)} />
      ) : (
        <Button className="mt-3" size="sm" variant="secondary" onClick={() => setIsAdding(true)}>
          添加邮箱
        </Button>
      )}
      <p className="mt-2 text-[12px] tracking-[-0.1px] text-kumo-subtle">
        每个邮箱只能属于一个账号，需要用发到该邮箱的验证码确认。提交邮箱用于 Git 提交署名；未设置时使用基于用户 ID 的地址。
      </p>
    </div>
  )
}
