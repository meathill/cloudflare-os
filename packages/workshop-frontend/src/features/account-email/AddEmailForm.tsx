import { useEffect, useState, type FormEvent } from 'react'
import { Banner, Button, Input } from '@cloudflare/kumo'
import { validateCommitEmail } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../../AuthContext'

const RESEND_COOLDOWN_SECONDS = 60

type AddEmailFormProps = {
  onAdded: () => void
  onCancel: () => void
}

/** Binds an email to the account: the code mailed to the address is the proof the user holds it. */
export const AddEmailForm = ({ onAdded, onCancel }: AddEmailFormProps) => {
  const { authenticatedApi } = useAuthenticatedApi()
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const address = email.trim().toLowerCase()

  const handleSendCode = async () => {
    try {
      validateCommitEmail(address)
    } catch {
      setError('输入类似 name@example.com 的邮箱地址')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await authenticatedApi.requestEmailVerification(address)
      setSentTo(address)
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setBusy(false)
    }
  }

  const handleConfirm = async (event: FormEvent) => {
    event.preventDefault()
    if (!sentTo || !code.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await authenticatedApi.confirmEmailVerification(sentTo, code.trim())
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : '邮箱验证失败')
    } finally {
      setBusy(false)
    }
  }

  const isCodeStep = sentTo !== null && sentTo === address

  return (
    <form onSubmit={handleConfirm} className="mt-3 space-y-3">
      {error && <Banner variant="error" title={error} />}
      <Input
        className="w-full"
        type="email"
        label="新邮箱"
        value={email}
        onChange={(e) => { setEmail(e.target.value); setError(null) }}
        autoComplete="email"
        autoFocus
        disabled={busy}
        placeholder="name@example.com"
      />
      {isCodeStep && (
        <Input
          className="w-full"
          label={`验证码（已发送到 ${sentTo}）`}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          disabled={busy}
          placeholder="6 位数字"
        />
      )}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={isCodeStep ? 'secondary' : 'primary'}
          onClick={handleSendCode}
          disabled={!address || busy || cooldown > 0}
          loading={busy && !isCodeStep}
        >
          {cooldown > 0 ? `${cooldown}s 后重发` : isCodeStep ? '重新发送' : '发送验证码'}
        </Button>
        {isCodeStep && (
          <Button type="submit" variant="primary" disabled={!code.trim()} loading={busy}>
            验证并添加
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          取消
        </Button>
      </div>
    </form>
  )
}
