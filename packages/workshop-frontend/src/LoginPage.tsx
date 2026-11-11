import { useEffect, useState, FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { RpcStub } from 'capnweb'
import { PublicApi } from '@gadgets/workshop-shared/api'
import { Hexagon } from '@phosphor-icons/react'
import { Input, Button, Banner, Loader } from '@cloudflare/kumo'
import { hashPassword } from './passwordHash'
import { useServerConfig, useServerConfigError, useSiteName } from './ServerConfigContext'
import { useDocumentTitle } from './useDocumentTitle'
import { useConnectionLost } from './RpcContext'
import OAuthButtons from './components/auth/OAuthButtons'
import SiteLogo from './components/SiteLogo'
import { deviceSessionSearch } from './features/native-app/DeviceSessionHandoff'


interface LoginPageProps {
  rpcStub: RpcStub<PublicApi>
  onLoginSuccess?: () => void
}

export default function LoginPage({ rpcStub, onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const serverConfig = useServerConfig()
  const serverConfigError = useServerConfigError()
  const siteName = useSiteName()
  const connectionLost = useConnectionLost()
  useDocumentTitle('登录')

  // The resend cooldown ticks down once a second while it runs.
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const finishLogin = (token: string) => {
    localStorage.setItem('authToken', token)
    if (onLoginSuccess) {
      onLoginSuccess()
    } else {
      window.location.reload()
    }
  }

  const handleSendCode = async () => {
    if (!email || otpSending || cooldown > 0) return
    setOtpSending(true)
    setError(null)
    try {
      await rpcStub.requestEmailOtp(email)
      setCooldown(60)
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码发送失败')
    } finally {
      setOtpSending(false)
    }
  }

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault()
    if (!email || !code || otpVerifying) return
    setOtpVerifying(true)
    setError(null)
    try {
      const token = await rpcStub.verifyEmailOtp(email, code)
      if (token) {
        finishLogin(token)
      } else {
        setError('验证码无效或已过期，请重新获取')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证码登录失败')
    } finally {
      setOtpVerifying(false)
    }
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username || !password || loading) return
    setLoading(true)
    setError(null)

    try {
      const passwordHash = await hashPassword(username, password)
      const token = await rpcStub.login(username, passwordHash)
      if (token) {
        finishLogin(token)
      } else {
        setError('用户名或密码错误')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  // Until the deployment config loads we don't know which auth methods are enabled, so don't guess:
  // defaulting to the password form would show it even where it's disabled (and hide configured
  // OAuth providers). This is especially important when the server is unreachable — serverConfig
  // stays null — so render a loading / connection state instead of a misconfigured form.
  if (!serverConfig) {
    if (serverConfigError && !connectionLost) {
      return (
        <div
          role="alert"
          className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto bg-kumo-base px-4 py-8"
        >
          <p className="text-sm text-kumo-danger text-center">
            无法加载部署设置。
          </p>
          <Button variant="secondary" onClick={() => window.location.reload()}>刷新</Button>
        </div>
      )
    }
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-y-auto bg-kumo-base px-4 py-8">
        <Loader size="lg" />
        <p className="text-sm text-kumo-subtle text-center">
          {connectionLost ? "无法连接服务器，正在重试…" : '正在加载…'}
        </p>
      </div>
    )
  }

  const authVendors = serverConfig.authVendors ?? []
  const passwordAuthEnabled = serverConfig.passwordAuthEnabled
  const emailOtpEnabled = serverConfig.emailOtpEnabled

  return (
    <div className="relative flex h-full min-h-0 flex-col items-center justify-start overflow-y-auto bg-kumo-base px-4 py-8">
      {/* Dot grid — fades from top to bottom */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--color-kumo-line) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
          maskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 70%)',
          WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0) 70%)',
        }}
      />

      <div className="relative my-auto w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <SiteLogo size={40} className="mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-kumo-brand mb-3">
              <Hexagon size={20} className="text-white" weight="bold" />
            </div>
          </SiteLogo>
          <h1 className="text-xl font-semibold text-kumo-default">{siteName}</h1>
          <p className="text-sm text-kumo-subtle mt-1">登录账号</p>
        </div>

        {error && (
          <Banner variant="error" title={error} className="mb-4" />
        )}

        {emailOtpEnabled && (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <Input
              className="w-full"
              type="email"
              label="邮箱"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              disabled={otpVerifying}
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
                disabled={otpVerifying}
                placeholder="6 位数字"
              />
              <Button
                type="button"
                variant="secondary"
                onClick={handleSendCode}
                disabled={!email || otpSending || cooldown > 0}
                loading={otpSending}
                className="shrink-0"
              >
                {cooldown > 0 ? `${cooldown}s 后重发` : '发送验证码'}
              </Button>
            </div>
            <Button
              type="submit"
              variant="primary"
              disabled={!email || !code}
              loading={otpVerifying}
              className="w-full justify-center"
            >
              邮箱登录 / 注册
            </Button>
          </form>
        )}

        {emailOtpEnabled && (passwordAuthEnabled || authVendors.length > 0) && (
          <div className="flex items-center gap-3 my-6">
            <div className="h-px flex-1 bg-kumo-line" />
            <span className="text-xs text-kumo-subtle">或</span>
            <div className="h-px flex-1 bg-kumo-line" />
          </div>
        )}

        {passwordAuthEnabled && (
          <>
            {/* Username / password form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                className="w-full"
                label="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                disabled={loading}
                placeholder="例如：writer"
              />

              <Input
                className="w-full"
                type="password"
                label="密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loading}
                placeholder="••••••••"
              />

              <Button
                type="submit"
                variant="primary"
                disabled={!username || !password}
                loading={loading}
                className="w-full justify-center"
              >
                登录
              </Button>
            </form>

            <p className="text-center text-sm text-kumo-subtle mt-6">
              还没有账号？{' '}
              <Link
                to="/signup"
                search={deviceSessionSearch(window.location.search)}
                className="text-kumo-brand hover:underline font-medium"
              >
                创建账号
              </Link>
            </p>
          </>
        )}

        {/* Gatekeeper sign-in options, shown whenever any auth vendor is configured. */}
        {authVendors.length > 0 && (
          <div className={passwordAuthEnabled ? 'mt-6' : ''}>
            {passwordAuthEnabled && (
              <div className="flex items-center gap-3 mb-4">
                <div className="h-px flex-1 bg-kumo-line" />
                <span className="text-xs text-kumo-subtle">或</span>
                <div className="h-px flex-1 bg-kumo-line" />
              </div>
            )}
            <OAuthButtons rpcStub={rpcStub} vendors={authVendors} onSuccess={onLoginSuccess} />
          </div>
        )}
      </div>
    </div>
  )
}
