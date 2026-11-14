import { useEffect, useState, type FormEvent } from 'react'
import type { RpcStub } from 'capnweb'
import type { PublicApi } from '@gadgets/workshop-shared/api'
import { Banner, Button, Input } from '@cloudflare/kumo'

const RESEND_COOLDOWN_SECONDS = 60

type EmailOtpFormProps = {
  rpcStub: RpcStub<PublicApi>
  submitLabel: string
  onSignedIn: (token: string) => void
}

/**
 * Email-code sign-in, which also creates the account on first use: the address is the account, so
 * the same form serves both the login and the signup page.
 */
const EmailOtpForm = ({ rpcStub, submitLabel, onSignedIn }: EmailOtpFormProps) => {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // The resend cooldown ticks down once a second while it runs.
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleSendCode = async () => {
    if (!email || sending || cooldown > 0) return
    setSending(true)
    setError(null)
    try {
      await rpcStub.requestEmailOtp(email)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setSending(false)
    }
  }

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !code || verifying) return
    setVerifying(true)
    setError(null)
    try {
      const token = await rpcStub.verifyEmailOtp(email, code)
      if (token) {
        onSignedIn(token)
      } else {
        setError('验证码无效或已过期，请重新获取')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码登录失败')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <form onSubmit={handleVerifyCode} className="space-y-4">
      {error && <Banner variant="error" title={error} />}
      <Input
        className="w-full"
        type="email"
        label="邮箱"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoFocus
        autoComplete="email"
        disabled={verifying}
        placeholder="you@example.com"
      />
      <div className="flex items-end gap-2">
        <Input
          className="w-full"
          label="验证码"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={verifying}
          placeholder="6 位数字"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={handleSendCode}
          disabled={!email || sending || cooldown > 0}
          loading={sending}
          className="shrink-0"
        >
          {cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
        </Button>
      </div>
      <Button
        type="submit"
        variant="primary"
        disabled={!email || !code}
        loading={verifying}
        className="w-full justify-center"
      >
        {submitLabel}
      </Button>
    </form>
  )
}

export default EmailOtpForm
