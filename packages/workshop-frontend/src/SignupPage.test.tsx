// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import type { PublicApi, ServerConfig } from '@gadgets/workshop-shared/api'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: unknown }) => <a href="/">{children as string}</a>,
}))

import SignupPage from './SignupPage'
import { ServerConfigContext } from './ServerConfigContext'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const baseConfig = {
  authVendors: [],
  passwordAuthEnabled: false,
  cloudflareLimitsEnabled: false,
  signupsEnabled: true,
  signupAllowlistEnabled: false,
  emailOtpEnabled: true,
  userSearchEnabled: false,
  siteName: '',
  announcement: '',
  banner: '',
  bannerColor: '',
  accentColor: '',
} as unknown as ServerConfig

describe('SignupPage', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
  })

  async function render(config: Partial<ServerConfig>) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(
        <ServerConfigContext.Provider value={{ ...baseConfig, ...config }}>
          <SignupPage rpcStub={{} as RpcStub<PublicApi>} />
        </ServerConfigContext.Provider>,
      )
    })
    return container
  }

  it('registers by email code when password signup is off', async () => {
    const page = await render({})
    expect(page.querySelector('input[type="email"]')).not.toBeNull()
    expect(page.querySelector('input[type="password"]')).toBeNull()
    expect(page.textContent).toContain('邮箱注册')
  })

  it('keeps password signup closed while email codes can register', async () => {
    const page = await render({ passwordAuthEnabled: true })
    expect(page.querySelector('input[type="email"]')).not.toBeNull()
    expect(page.querySelector('input[type="password"]')).toBeNull()
  })

  it('offers no form while signups are closed', async () => {
    const page = await render({ signupsEnabled: false })
    expect(page.querySelector('input')).toBeNull()
    expect(page.textContent).toContain('注册已关闭')
  })
})
