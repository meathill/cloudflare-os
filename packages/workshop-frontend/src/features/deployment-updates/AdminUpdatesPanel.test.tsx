// @vitest-environment jsdom
/* eslint-disable react/react-in-jsx-scope */

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RpcStub } from 'capnweb'
import { MAX_UPDATE_CHECK_INTERVAL_MINUTES, MAX_UPDATE_HOURS } from '@gadgets/workshop-shared/api'
import type { AdminApi, DeploymentUpdateStatus } from '@gadgets/workshop-shared/api'
import { formatFullTimestamp } from '../../utils/formatTimestamp'
import { testUpdateStatus } from './updateStatusFixture'

const { addToast, probeRouterTag } = vi.hoisted(() => ({
  addToast: vi.fn<(toast: { title: string; description?: string; variant: string }) => void>(),
  probeRouterTag: vi.fn<() => Promise<void>>(async () => {}),
}))

vi.mock('./probeRouterTag', () => ({ probeRouterTag }))

vi.mock('@cloudflare/kumo', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@cloudflare/kumo')>()),
  useKumoToastManager: () => ({ add: addToast }),
}))

import { AdminUpdatesPanel } from './AdminUpdatesPanel'

const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
const previousActEnvironment = testGlobal.IS_REACT_ACT_ENVIRONMENT
testGlobal.IS_REACT_ACT_ENVIRONMENT = true
afterAll(() => {
  if (previousActEnvironment === undefined) delete testGlobal.IS_REACT_ACT_ENVIRONMENT
  else testGlobal.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const CHECKS_LABEL = '自动检查更新'
const CHECK_INTERVAL_LABEL = '检查更新间隔（分钟）'
const MINIMUM_AGE_LABEL = '版本发布后的最短等待时间（小时）'
const SNOOZE_LABEL = '关闭通知后隐藏时长（小时）'

// Each duration field, with the setter that saves it, the status field that reports it, its unit
// and the range the server accepts, and part of what its help says.
const DURATION_FIELDS = [
  {
    label: CHECK_INTERVAL_LABEL, setter: 'setUpdateCheckIntervalMinutes', reported: 'checkIntervalMinutes',
    unit: 'minutes', min: 1, max: MAX_UPDATE_CHECK_INTERVAL_MINUTES, means: '不按计划执行',
  },
  {
    label: MINIMUM_AGE_LABEL, setter: 'setUpdateMinimumAgeHours', reported: 'minimumAgeHours',
    unit: 'hours', min: 0, max: MAX_UPDATE_HOURS, means: '更新始终安装最新版本',
  },
  {
    label: SNOOZE_LABEL, setter: 'setUpdateNoticeSnoozeHours', reported: 'noticeSnoozeHours',
    unit: 'hours', min: 0, max: MAX_UPDATE_HOURS,
    means: '设为 0 时，下次访问首页会再次显示',
  },
] as const

const fakeAdmin = () => ({
  setUpdateChecksEnabled: vi.fn<AdminApi['setUpdateChecksEnabled']>(async () => {}),
  setUpdateCheckIntervalMinutes: vi.fn<AdminApi['setUpdateCheckIntervalMinutes']>(async () => {}),
  setUpdateMinimumAgeHours: vi.fn<AdminApi['setUpdateMinimumAgeHours']>(async () => {}),
  setUpdateNoticeSnoozeHours: vi.fn<AdminApi['setUpdateNoticeSnoozeHours']>(async () => {}),
  checkForUpdates: vi.fn<AdminApi['checkForUpdates']>(async () => testUpdateStatus()),
})

const type = (element: HTMLInputElement, value: string) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, value)
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
})

const click = (element: HTMLElement) => act(async () => { element.click() })

const focus = (element: HTMLElement) => act(async () => { element.focus() })

// What a browser does to a control with focus that a call disables. jsdom leaves focus on such a
// control and won't blur it either, so focus leaves by way of a button that takes it and goes.
const dropFocus = () => act(async () => {
  const elsewhere = document.body.appendChild(document.createElement('button'))
  elsewhere.focus()
  elsewhere.blur()
  elsewhere.remove()
})

describe('AdminUpdatesPanel', () => {
  let container: HTMLDivElement
  let root: Root

  const render = async (status: DeploymentUpdateStatus = testUpdateStatus()) => {
    const admin = fakeAdmin()
    const onChanged = vi.fn<() => Promise<void>>(async () => {})
    // Shows what a re-read of the status reported.
    const show = (reported: DeploymentUpdateStatus) => act(async () => root.render(
      <AdminUpdatesPanel
        admin={admin as unknown as RpcStub<AdminApi>}
        status={reported}
        onChanged={onChanged}
      />))
    await show(status)
    return { ...admin, onChanged, show }
  }

  // The value shown beside each label of the panel's description list.
  const field = (label: string) => {
    const term = [...container.querySelectorAll('dt')].find(dt => dt.textContent === label)
    if (!term) throw new Error(`no ${label} field`)
    return term.nextElementSibling?.textContent
  }

  const updateLink = () =>
    [...container.querySelectorAll('a')].find(link => link.textContent?.trim() === '更新')

  // The outermost element whose text begins with the notice's title: the notice itself.
  const unfinishedNotice = () =>
    [...container.querySelectorAll('div')]
      .find(element => element.textContent?.startsWith('更新未完成'))

  const button = (name: string) => {
    const element = [...container.querySelectorAll('button')]
      .find((b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name)
    if (!element) throw new Error(`no button ${name}`)
    return element
  }

  const checksSwitch = () => {
    const element = button(CHECKS_LABEL)
    if (element.getAttribute('role') !== 'switch') throw new Error('not a switch')
    return element
  }

  // The checkbox the switch forwards its clicks to. jsdom has no PointerEvent, which the switch
  // forwards them with.
  const checksCheckbox = () => {
    const input = checksSwitch().nextElementSibling
    if (!(input instanceof HTMLInputElement)) throw new Error('no checkbox behind the switch')
    return input
  }

  const labeledInput = (label: string) => {
    const labelElement = [...container.querySelectorAll('label')]
      .find((element) => element.textContent?.startsWith(label))
    if (!labelElement) throw new Error(`no label ${label}`)
    const element = document.getElementById(labelElement.htmlFor)
    if (!(element instanceof HTMLInputElement)) throw new Error(`no input labeled ${label}`)
    return element
  }

  const saveButton = (label: string) => button(`保存“${label}”`)

  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    addToast.mockReset()
    vi.restoreAllMocks()
  })

  describe('release', () => {
    it('shows the running and newest release, when it was checked, and that an update is available', async () => {
      const checkedAt = new Date('2026-10-03T12:30:00Z')

      await render(testUpdateStatus({
        currentReleaseId: 'r100-aaaaaaa',
        latestReleaseId: 'r101-bbbbbbb',
        checkedAt,
      }))

      expect(field('当前版本')).toBe('r100-aaaaaaa')
      expect(field('最新版本')).toBe('r101-bbbbbbb')
      expect(field('上次检查')).toBe(formatFullTimestamp(checkedAt))
      expect(field('有可用更新')).toBe('是')
    })

    it('says when the deployment already runs the newest release', async () => {
      await render(testUpdateStatus({
        latestReleaseId: 'r100-aaaaaaa',
        updateAvailable: false,
        availableSince: undefined,
        notify: false,
      }))

      expect(field('有可用更新')).toBe('否')
    })

    it('says that nothing is known before a check has succeeded', async () => {
      await render(testUpdateStatus({
        latestReleaseId: undefined,
        updateAvailable: false,
        availableSince: undefined,
        notify: false,
        checkedAt: undefined,
      }))

      expect(field('当前版本')).toBe('r100-aaaaaaa')
      expect(field('最新版本')).toBe('尚无成功的检查')
      expect(field('上次检查')).toBe('从未')
      expect(field('有可用更新')).toBe('检查成功后才能确定')
    })

    it('links Update to the deploy flow in a new tab', async () => {
      const updateUrl = 'https://deploy.example.com/#flow=upgrade&account=acct&installation=0123abcd&name=os'

      await render(testUpdateStatus({ updateUrl }))

      const link = updateLink()
      expect(link?.getAttribute('href')).toBe(updateUrl)
      expect(link?.getAttribute('target')).toBe('_blank')
      expect(link?.getAttribute('rel')).toContain('noopener')
    })

    // The deploy flow, not this page, decides whether there is anything to install.
    it('offers Update when no update is known', async () => {
      await render(testUpdateStatus({ updateAvailable: false, notify: false }))

      expect(updateLink()).toBeDefined()
    })

    it.each([
      'javascript:alert(1)',
      'data:text/html,<p>hi</p>',
      '/#flow=upgrade',
      'not a url',
      '',
    ])('renders no Update link for %j', async (updateUrl) => {
      await render(testUpdateStatus({ updateUrl }))

      expect(updateLink()).toBeUndefined()
      expect(container.querySelector('a')).toBeNull()
    })

    it('warns, as an alert, that a modified deployment cannot be upgraded, naming its modified Workers', async () => {
      await render(testUpdateStatus({
        modified: true,
        modifiedWorkers: ['backend', 'google2', 'router'],
        notify: false,
      }))

      const alert = container.querySelector('[role="alert"]')
      expect(alert?.textContent).toContain('此部署在部署流程外发生了更改')
      expect(alert?.textContent)
        .toContain('以下组件运行的版本与部署流程安装的版本不一致：后端、“google2”连接服务和路由器。')
      expect(alert?.textContent).toContain('拒绝升级')
      // Still offered: the deploy flow explains the refusal itself.
      expect(updateLink()).toBeDefined()
    })

    it('says, apart from any warning, that an update did not finish, naming the Workers behind', async () => {
      await render(testUpdateStatus({ unfinishedWorkers: ['github', 'router'] }))

      const notice = unfinishedNotice()
      expect(notice?.textContent)
        .toContain('以下组件仍在运行此部署的其他版本：“github”连接服务和路由器。')
      expect(notice?.textContent).toContain('可通过部署流程完成更新。')
      expect(notice?.getAttribute('role')).not.toBe('alert')
      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(updateLink()).toBeDefined()
    })

    it('shows both the warning and the unfinished update when both apply, without contradicting the refusal', async () => {
      await render(testUpdateStatus({
        modified: true,
        modifiedWorkers: ['backend'],
        unfinishedWorkers: ['router'],
        notify: false,
      }))

      expect(container.querySelector('[role="alert"]')?.textContent)
        .toContain('以下组件运行的版本与部署流程安装的版本不一致：后端。')
      const notice = unfinishedNotice()?.textContent
      expect(notice).toContain('以下组件仍在运行此部署的其他版本：路由器。')
      expect(notice)
        .toContain('恢复在部署流程外更改的 Worker 后，即可通过部署流程完成更新。')
      expect(notice).not.toContain('路由器。可通过部署流程完成更新。')
    })

    it('shows neither a warning nor an unfinished update for a deployment that runs what was installed', async () => {
      await render(testUpdateStatus({ modified: false, modifiedWorkers: [], unfinishedWorkers: [] }))

      expect(container.querySelector('[role="alert"]')).toBeNull()
      expect(unfinishedNotice()).toBeUndefined()
      expect(container.textContent).not.toContain('仍在运行此部署的其他版本')
    })
  })

  describe('Check now', () => {
    it('asks for the newest release, then re-reads the status', async () => {
      const { checkForUpdates, onChanged } = await render()

      await click(button('立即检查'))

      expect(checkForUpdates).toHaveBeenCalledOnce()
      expect(onChanged).toHaveBeenCalledOnce()
      expect(checkForUpdates.mock.invocationCallOrder[0])
        .toBeLessThan(onChanged.mock.invocationCallOrder[0])
    })

    // The status names a modified router by the tag the backend recorded for it.
    it('has the backend record the router’s tag before checking', async () => {
      probeRouterTag.mockClear()
      const { checkForUpdates } = await render()

      await click(button('立即检查'))

      expect(probeRouterTag).toHaveBeenCalledOnce()
      expect(probeRouterTag.mock.invocationCallOrder[0])
        .toBeLessThan(checkForUpdates.mock.invocationCallOrder[0]!)
    })

    it('announces the update a check found', async () => {
      const { checkForUpdates } = await render(testUpdateStatus({
        latestReleaseId: 'r100-aaaaaaa',
        updateAvailable: false,
        availableSince: undefined,
        notify: false,
      }))
      checkForUpdates.mockResolvedValueOnce(testUpdateStatus({ latestReleaseId: 'r102-ccccccc' }))

      await click(button('立即检查'))

      expect(addToast).toHaveBeenCalledExactlyOnceWith({
        title: '有可用更新：版本 r102-ccccccc',
        variant: 'success',
      })
    })

    it('announces that a check found no update', async () => {
      const { checkForUpdates } = await render()
      checkForUpdates.mockResolvedValueOnce(testUpdateStatus({
        latestReleaseId: 'r100-aaaaaaa',
        updateAvailable: false,
        availableSince: undefined,
        notify: false,
      }))

      await click(button('立即检查'))

      expect(addToast).toHaveBeenCalledExactlyOnceWith({
        title: '没有可用更新：此部署运行的是最新版本',
        variant: 'success',
      })
    })

    // The re-read hides the tab of a deployment the deploy flow no longer claims.
    it('announces nothing when the deployment is no longer installed by the deploy flow', async () => {
      const { checkForUpdates, onChanged } = await render()
      checkForUpdates.mockResolvedValueOnce(null)

      await click(button('立即检查'))

      expect(addToast).not.toHaveBeenCalled()
      expect(onChanged).toHaveBeenCalledOnce()
    })

    // Automatic checks being off is what Check now is for.
    it('asks while automatic checks are off', async () => {
      const { checkForUpdates } = await render(testUpdateStatus({ checksEnabled: false, notify: false }))

      await click(button('立即检查'))

      expect(checkForUpdates).toHaveBeenCalledOnce()
    })

    it('cannot be pressed again while a check is in flight', async () => {
      const { checkForUpdates } = await render()
      const call = deferred<DeploymentUpdateStatus | null>()
      checkForUpdates.mockReturnValueOnce(call.promise)

      await click(button('立即检查'))

      expect(button('立即检查').disabled).toBe(true)
      await click(button('立即检查'))
      expect(checkForUpdates).toHaveBeenCalledOnce()

      await act(async () => call.resolve(testUpdateStatus()))

      expect(button('立即检查').disabled).toBe(false)
    })

    it('reports a failed check with the server’s message and re-reads nothing', async () => {
      const { checkForUpdates, onChanged } = await render()
      checkForUpdates.mockRejectedValueOnce(new Error('The update check answered 503.'))

      await click(button('立即检查'))

      expect(addToast).toHaveBeenCalledExactlyOnceWith({
        title: '无法检查更新',
        description: 'The update check answered 503.',
        variant: 'error',
      })
      expect(onChanged).not.toHaveBeenCalled()
      expect(button('立即检查').disabled).toBe(false)
    })

    it('reports a failed re-read after a check that went through', async () => {
      const { onChanged } = await render()
      onChanged.mockRejectedValueOnce(new Error('Admin settings are unavailable.'))

      await click(button('立即检查'))

      expect(addToast).toHaveBeenCalledTimes(2)
      expect(addToast).toHaveBeenLastCalledWith(expect.objectContaining({
        title: '无法重新加载更新状态',
        variant: 'error',
      }))
    })
  })

  describe('automatic update checks', () => {
    it.each([true, false])('shows %s as the server reported it, with what it means', async (enabled) => {
      await render(testUpdateStatus({ checksEnabled: enabled }))

      expect(checksSwitch().getAttribute('aria-checked')).toBe(String(enabled))
      const meaning = document.getElementById(checksSwitch().getAttribute('aria-describedby')!)
      expect(meaning?.textContent).toContain('仅在管理员点击“立即检查”时检查')
    })

    it.each([true, false])('sets the opposite of %s, then re-reads the status', async (enabled) => {
      const { setUpdateChecksEnabled, onChanged } = await render(testUpdateStatus({ checksEnabled: enabled }))

      await click(checksCheckbox())

      expect(setUpdateChecksEnabled).toHaveBeenCalledExactlyOnceWith(!enabled)
      expect(onChanged).toHaveBeenCalledOnce()
      expect(setUpdateChecksEnabled.mock.invocationCallOrder[0])
        .toBeLessThan(onChanged.mock.invocationCallOrder[0])
      // The re-read is what moves the switch.
      expect(checksSwitch().getAttribute('aria-checked')).toBe(String(enabled))
    })

    it('cannot be changed again while the change is in flight', async () => {
      const { setUpdateChecksEnabled } = await render()
      const call = deferred()
      setUpdateChecksEnabled.mockReturnValueOnce(call.promise)

      await click(checksCheckbox())

      expect(checksSwitch().disabled).toBe(true)
      await click(checksCheckbox())
      expect(setUpdateChecksEnabled).toHaveBeenCalledOnce()

      await act(async () => call.resolve())

      expect(checksSwitch().disabled).toBe(false)
    })

    it('reports a refused change with the server’s message and keeps showing the server’s value', async () => {
      const { setUpdateChecksEnabled, onChanged } = await render()
      setUpdateChecksEnabled.mockRejectedValueOnce(new Error('Admin settings are unavailable.'))

      await click(checksCheckbox())

      expect(addToast).toHaveBeenCalledExactlyOnceWith({
        title: `无法更新“${CHECKS_LABEL}”`,
        description: 'Admin settings are unavailable.',
        variant: 'error',
      })
      expect(onChanged).not.toHaveBeenCalled()
      expect(checksSwitch().getAttribute('aria-checked')).toBe('true')
      expect(checksSwitch().disabled).toBe(false)
    })

    // The status the switch would fall back to is the one the write replaced.
    it('shows what it wrote when the re-read after the write fails, so the next change undoes it', async () => {
      const { setUpdateChecksEnabled, onChanged } = await render(testUpdateStatus({ checksEnabled: false }))
      onChanged.mockRejectedValueOnce(new Error('Admin settings are unavailable.'))

      await click(checksCheckbox())

      expect(addToast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        title: '无法重新加载更新状态',
      }))
      expect(checksSwitch().getAttribute('aria-checked')).toBe('true')

      await click(checksCheckbox())

      expect(setUpdateChecksEnabled).toHaveBeenNthCalledWith(1, true)
      expect(setUpdateChecksEnabled).toHaveBeenLastCalledWith(false)
    })

    it('shows the server’s value again once a later status arrives', async () => {
      const { onChanged, show } = await render(testUpdateStatus({ checksEnabled: false }))
      onChanged.mockRejectedValueOnce(new Error('Admin settings are unavailable.'))
      await click(checksCheckbox())
      expect(checksSwitch().getAttribute('aria-checked')).toBe('true')

      // Another admin turned checks off again before this one's next re-read.
      await show(testUpdateStatus({ checksEnabled: false }))

      expect(checksSwitch().getAttribute('aria-checked')).toBe('false')
    })
  })

  describe.each(DURATION_FIELDS)('$label', ({ label, setter, reported, unit, min, max, means }) => {
    it('shows the server’s hours, with what they mean', async () => {
      await render(testUpdateStatus({ [reported]: 36 }))

      expect(labeledInput(label).value).toBe('36')
      const described = (labeledInput(label).getAttribute('aria-describedby') ?? '').split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '').join(' ')
      expect(described).toContain(means)
    })

    it.each([String(min), '48', String(max)])('saves %s, then re-reads the status', async (value) => {
      const admin = await render()

      await type(labeledInput(label), value)
      await click(saveButton(label))

      expect(admin[setter]).toHaveBeenCalledExactlyOnceWith(Number(value))
      expect(admin.onChanged).toHaveBeenCalledOnce()
      expect(admin[setter].mock.invocationCallOrder[0])
        .toBeLessThan(admin.onChanged.mock.invocationCallOrder[0])
    })

    it('saves only its own field', async () => {
      const admin = await render()

      await type(labeledInput(label), '48')
      await click(saveButton(label))

      for (const other of DURATION_FIELDS.filter((entry) => entry.label !== label)) {
        expect(admin[other.setter]).not.toHaveBeenCalled()
      }
    })

    it.each([min - 1, max + 1])('refuses %s, outside what the server accepts, without a call', async (outside) => {
      const admin = await render()

      await type(labeledInput(label), String(outside))
      await click(saveButton(label))

      expect(admin[setter]).not.toHaveBeenCalled()
      expect(container.textContent).toContain(`请输入 ${min} 到 ${max} 之间的整数（${unit === 'hours' ? '小时' : '分钟'}）`)
    })

    it('reports a refused save with the server’s message and keeps what was typed', async () => {
      const admin = await render()
      admin[setter].mockRejectedValueOnce(new Error('Admin settings are unavailable.'))

      await type(labeledInput(label), '48')
      await click(saveButton(label))

      expect(addToast).toHaveBeenCalledExactlyOnceWith({
        title: `无法更新“${label}”`,
        description: 'Admin settings are unavailable.',
        variant: 'error',
      })
      expect(admin.onChanged).not.toHaveBeenCalled()
      expect(labeledInput(label).value).toBe('48')
      expect(labeledInput(label).disabled).toBe(false)
    })

    // The hours the field would fall back to are the ones the save replaced.
    it('keeps showing the saved hours when the re-read after the save fails, and saves them again', async () => {
      const admin = await render(testUpdateStatus({ [reported]: 24 }))
      admin.onChanged.mockRejectedValueOnce(new Error('Admin settings are unavailable.'))

      await type(labeledInput(label), '48')
      await click(saveButton(label))

      expect(addToast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        title: '无法重新加载更新状态',
        variant: 'error',
      }))
      expect(labeledInput(label).value).toBe('48')

      await click(saveButton(label))

      expect(admin[setter]).toHaveBeenCalledTimes(2)
      expect(admin[setter]).toHaveBeenLastCalledWith(48)
    })
  })

  // The switch and Check now are disabled for as long as their call takes, and a disabled control
  // loses focus.
  describe('focus across a call', () => {
    it('returns to the switch that was turned', async () => {
      const { setUpdateChecksEnabled } = await render()
      const call = deferred()
      setUpdateChecksEnabled.mockReturnValueOnce(call.promise)

      await focus(checksSwitch())
      await click(checksCheckbox())
      await dropFocus()
      expect(checksSwitch().disabled).toBe(true)
      expect(document.activeElement).toBe(document.body)

      await act(async () => call.resolve())

      expect(document.activeElement).toBe(checksSwitch())
    })

    it('returns to Check now once its check fails', async () => {
      const { checkForUpdates } = await render()
      const call = deferred<DeploymentUpdateStatus | null>()
      checkForUpdates.mockReturnValueOnce(call.promise)

      await focus(button('立即检查'))
      await click(button('立即检查'))
      await dropFocus()
      expect(button('立即检查').disabled).toBe(true)
      expect(document.activeElement).toBe(document.body)

      await act(async () => call.reject(new Error('The update check answered 503.')))

      expect(document.activeElement).toBe(button('立即检查'))
    })

    it('returns to the Save button of an hour field', async () => {
      const { setUpdateMinimumAgeHours } = await render()
      const call = deferred()
      setUpdateMinimumAgeHours.mockReturnValueOnce(call.promise)
      await type(labeledInput(MINIMUM_AGE_LABEL), '48')

      await focus(saveButton(MINIMUM_AGE_LABEL))
      await click(saveButton(MINIMUM_AGE_LABEL))
      await dropFocus()
      expect(saveButton(MINIMUM_AGE_LABEL).disabled).toBe(true)
      expect(document.activeElement).toBe(document.body)

      await act(async () => call.resolve())

      expect(document.activeElement).toBe(saveButton(MINIMUM_AGE_LABEL))
    })
  })
})
