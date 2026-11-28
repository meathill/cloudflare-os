import { Button } from '@cloudflare/kumo'
import { useEffect, useState } from 'react'
import type { RpcStub } from 'capnweb'
import type { AiChatAuthorInfo, AuthenticatedApi, DeviceSessionHandoffStart } from '@gadgets/workshop-shared/api'
import { logRpcFailure, rpcFailureDescription } from '../../rpcErrors'

const STATE_PARAMETER = 'cfos_native_state'
const KEY_PARAMETER = 'cfos_native_key'
const OPAQUE_STATE = /^[A-Za-z0-9._~-]{16,512}$/
const PUBLIC_KEY = /^[A-Za-z0-9_-]{87}$/

export type DeviceSessionAttempt = { state: string; publicKey: string }

/** Parse the native app's bounded opaque state and unpadded P-256 public key. */
export const deviceSessionAttempt = (search: string): DeviceSessionAttempt | null => {
  const params = new URLSearchParams(search)
  const states = params.getAll(STATE_PARAMETER)
  const keys = params.getAll(KEY_PARAMETER)
  if (states.length !== 1 || !OPAQUE_STATE.test(states[0]) || keys.length !== 1 ||
      !PUBLIC_KEY.test(keys[0])) return null
  return { state: states[0], publicKey: keys[0] }
}

/** Whether a URL is trying to start a device session, including a malformed attempt. */
export const hasDeviceSessionParameters = (search: string): boolean => {
  const params = new URLSearchParams(search)
  return params.has(STATE_PARAMETER) || params.has(KEY_PARAMETER)
}

/** Keep only a validated device-session attempt when navigating between authentication pages. */
export const deviceSessionSearch = (search: string): {
  cfos_native_state?: string
  cfos_native_key?: string
} => {
  const attempt = deviceSessionAttempt(search)
  return attempt ? {
    [STATE_PARAMETER]: attempt.state,
    [KEY_PARAMETER]: attempt.publicKey,
  } : {}
}

/** Build an authentication destination without forwarding unrelated or invalid search data. */
export const deviceSessionDestination = (pathname: string, search: string): string => {
  const preserved = deviceSessionSearch(search)
  const params = new URLSearchParams()
  for (const [name, value] of Object.entries(preserved)) params.set(name, value)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

/** Navigate the browser through the single-use callback without exposing its response to script. */
export const submitDeviceSession = (state: string, start: DeviceSessionHandoffStart): void => {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = '/api/device-session/callback'
  form.style.display = 'none'
  for (const [name, value] of Object.entries({ state, ...start })) {
    const input = document.createElement('input')
    input.name = name
    input.value = value
    form.append(input)
  }
  document.body.append(form)
  try {
    form.submit()
  } finally {
    form.remove()
  }
}

/** Ask the user before transferring an install session to the native Cloudflare OS app. */
export const DeviceSessionHandoff = ({
  authenticatedApi,
}: {
  authenticatedApi: RpcStub<AuthenticatedApi>
}) => {
  const attempt = deviceSessionAttempt(window.location.search)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [identity, setIdentity] = useState<{
    api: RpcStub<AuthenticatedApi>
    user: AiChatAuthorInfo | null
    failed: boolean
  } | null>(null)
  const confirmedUser = identity?.api === authenticatedApi && identity.user?.type === 'user'
    ? identity.user : null
  const identityFailed = identity?.api === authenticatedApi && identity.failed

  useEffect(() => {
    let cancelled = false
    authenticatedApi.whoami().then(user => {
      if (!cancelled) setIdentity({ api: authenticatedApi, user, failed: user.type !== 'user' })
    }).catch(() => {
      if (!cancelled) setIdentity({ api: authenticatedApi, user: null, failed: true })
    })
    return () => { cancelled = true }
  }, [authenticatedApi])

  const continueInApp = async () => {
    if (!attempt || !confirmedUser || working) return
    setWorking(true)
    setError(null)
    try {
      const start = await authenticatedApi.beginDeviceSessionHandoff(
        attempt.publicKey,
        attempt.state,
      )
      submitDeviceSession(attempt.state, start)
    } catch (err) {
      logRpcFailure('Failed to prepare a device session:', err)
      setError(rpcFailureDescription(err) ?? '无法准备设备会话，请重试。')
      setWorking(false)
    }
  }

  if (!attempt) {
    return (
      <main className="flex min-h-full items-center justify-center bg-kumo-base p-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <h1 className="text-lg font-semibold text-kumo-default">无法启动应用登录</h1>
          <p role="alert" className="text-sm text-kumo-danger">
            设备会话请求无效。请返回应用重新开始。
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex min-h-full items-center justify-center bg-kumo-base p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        {working && <div aria-hidden="true" className="h-8 w-8 animate-spin rounded-full border-2 border-kumo-brand border-t-transparent" />}
        <h1 className="text-lg font-semibold text-kumo-default">
          {working ? '正在完成登录…' : '在 Cloudflare OS 中继续？'}
        </h1>
        <p className="text-sm text-kumo-subtle">
          {working
            ? '浏览器将关闭并返回应用。'
            : '仅当你从 Cloudflare OS 应用发起此次登录时才继续。'}
        </p>
        {!working && identityFailed && (
          <p role="alert" className="text-sm text-kumo-danger">
            无法确认你的账号。请返回应用重试。
          </p>
        )}
        {!working && !identityFailed && (
          <p className="text-sm text-kumo-subtle">
            {confirmedUser
              ? `已在 ${window.location.host} 登录为 ${confirmedUser.name}（${confirmedUser.id}）。`
              : '正在检查账号…'}
          </p>
        )}
        {error && <p role="alert" className="text-sm text-kumo-danger">{error}</p>}
        {!working && !identityFailed && (
          <Button variant="primary" disabled={!confirmedUser} onClick={() => { void continueInApp() }}>
            在 Cloudflare OS 中继续
          </Button>
        )}
      </div>
    </main>
  )
}
