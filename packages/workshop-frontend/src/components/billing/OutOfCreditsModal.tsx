import { useCallback, useEffect, useRef, useState } from 'react'
import { CloudflareUsageInfo, CloudflareAccountOption } from '@gadgets/workshop-shared/api'
import { Dialog, Button, Loader, useKumoToastManager } from '@cloudflare/kumo'
import { CloudWarning, Lightning } from '@phosphor-icons/react'
import { useOptionalAuthenticatedApi } from '../../AuthContext'
import { buildAddCreditsUrl } from './creditsUrl'
import ResetCountdown from './ResetCountdown'
import { NATIVE_CONNECT_COMPLETE_EVENT, openConnectWindow } from '../../connectHandoff'
import { AuthPopupCancelledError } from '../../features/native-app/authPopup'

interface OutOfCreditsModalProps {
  open: boolean
  onClose: () => void
}

/**
 * Modal shown when a user has exhausted their free daily allowance. Guides them to connect their
 * Cloudflare account (if not connected), pick which account to bill (if they have several), or top
 * up credits in the Cloudflare dashboard (if connected but low balance).
 */
export default function OutOfCreditsModal({ open, onClose }: OutOfCreditsModalProps) {
  const auth = useOptionalAuthenticatedApi()
  const toasts = useKumoToastManager()
  const [usage, setUsage] = useState<CloudflareUsageInfo | null>(null)
  const [connecting, setConnecting] = useState(false)
  const refreshVersion = useRef(0)
  const [accounts, setAccounts] = useState<CloudflareAccountOption[] | null>(null)
  const [selecting, setSelecting] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!auth) return
    const version = ++refreshVersion.current
    auth.authenticatedApi.getCloudflareUsage()
      .then((u: CloudflareUsageInfo) => { if (version === refreshVersion.current) setUsage(u) })
      .catch(() => {})
  }, [auth])

  useEffect(() => {
    if (!open || !auth) return
    setUsage(null)
    setAccounts(null)
    refresh()
    // Re-check when the tab regains focus, so returning from the "Connect Cloudflare" OAuth pop-up
    // updates the modal (connected state / balance / account list) without reopening it.
    const onFocus = () => {
      setAccounts(null)
      refresh()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener(NATIVE_CONNECT_COMPLETE_EVENT, onFocus)
    return () => {
      ++refreshVersion.current
      window.removeEventListener('focus', onFocus)
      window.removeEventListener(NATIVE_CONNECT_COMPLETE_EVENT, onFocus)
    }
  }, [open, auth, refresh])

  // Load the account list when the server says the user must pick one.
  useEffect(() => {
    if (!auth) return
    let cancelled = false
    if (usage?.connected && usage.needsAccountSelection && accounts === null) {
      auth.authenticatedApi.listCloudflareAccounts()
        .then((list: CloudflareAccountOption[]) => { if (!cancelled) setAccounts(list) })
        .catch(() => { if (!cancelled) setAccounts([]) })
    }
    return () => { cancelled = true }
  }, [auth, usage, accounts])

  const connect = async () => {
    if (!auth) return
    setConnecting(true)
    try {
      await openConnectWindow(await auth.authenticatedApi.connectAccount('cloudflare', []), auth.authenticatedApi)
    } catch (err) {
      if (err instanceof AuthPopupCancelledError) return
      toasts.add({
        title: '无法连接 Cloudflare',
        description: err instanceof Error ? err.message : undefined,
        variant: 'error',
      })
    } finally {
      setConnecting(false)
    }
  }

  const selectAccount = async (accountId: string) => {
    if (!auth) return
    setSelecting(accountId)
    try {
      await auth.authenticatedApi.selectCloudflareAccount(accountId)
      setAccounts(null)
      refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : '选择账号失败'
      toasts.add({ title: msg, variant: 'error' })
    } finally {
      setSelecting(null)
    }
  }

  const connected = usage?.connected ?? false
  const needsSelection = connected && (usage?.needsAccountSelection ?? false)

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog className="responsive-dialog overflow-y-auto p-6 sm:w-[560px]" size="base">
        <Dialog.Title className="text-lg font-semibold mb-2 flex items-center gap-2">
          <CloudWarning size={22} weight="bold" className="text-kumo-warning" />
          你已用完免费额度
        </Dialog.Title>

        {usage === null ? (
          <div className="flex justify-center py-8"><Loader size="base" /></div>
        ) : (
          <div className="space-y-4">
            {!connected ? (
              <p className="text-sm text-kumo-subtle">
                今天的 {usage.dailyLimit} 次免费请求已全部用完。连接 Cloudflare 账号即可继续创作，超出免费额度的用量将从你的 Cloudflare AI Gateway 余额中扣除。
                {usage.resetAt && (
                  <> 免费额度将在 UTC 00:00 重置，距离重置还有 <ResetCountdown resetAt={usage.resetAt} onElapsed={refresh} />。</>
                )}
              </p>
            ) : needsSelection ? (
              <p className="text-sm text-kumo-subtle">
                你的 Cloudflare 连接可以访问多个账号，请选择用于支付免费额度以外用量的 AI Gateway 余额。
              </p>
            ) : (
              <p className="text-sm text-kumo-subtle">
                你的 Cloudflare 账号已连接{usage.balance !== null && <>，余额为 <strong>${usage.balance.toFixed(2)}</strong></>}，但余额不足以继续。请为 AI Gateway 充值后继续创作。
                {usage.resetAt && (
                  <> 你也可以等待免费额度在 UTC 00:00 重置，距离重置还有 <ResetCountdown resetAt={usage.resetAt} onElapsed={refresh} />。</>
                )}
              </p>
            )}

            {needsSelection && (
              <div className="flex flex-col gap-2">
                {accounts === null ? (
                  <p className="text-sm text-kumo-subtle">正在加载账号…</p>
                ) : accounts.length === 0 ? (
                  <p className="text-sm text-kumo-subtle">此连接没有可用账号。</p>
                ) : (
                  accounts.map((a) => (
                    <Button
                      key={a.accountId}
                      variant="secondary"
                      className="justify-start"
                      onClick={() => selectAccount(a.accountId)}
                      loading={selecting === a.accountId}
                      disabled={selecting !== null}
                    >
                      {a.accountName}
                    </Button>
                  ))
                )}
              </div>
            )}

            <p className="text-sm text-kumo-subtle">
              了解更多：{' '}
              <a
                href="https://developers.cloudflare.com/ai-gateway/features/unified-billing/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                AI Gateway 统一计费
              </a>
              .
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              {!connected ? (
                <>
                  <Button variant="secondary" onClick={onClose}>稍后再说</Button>
                  <Button variant="primary" onClick={connect} loading={connecting}>
                    <Lightning size={16} weight="bold" />
                    连接 Cloudflare
                  </Button>
                </>
              ) : needsSelection ? (
                <Button variant="secondary" onClick={onClose}>关闭</Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={onClose}>关闭</Button>
                  <Button
                    variant="primary"
                    onClick={() => window.open(buildAddCreditsUrl(usage.accountId), '_blank')}
                  >
                    在 Cloudflare 充值
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </Dialog>
    </Dialog.Root>
  )
}
