import { useEffect, useId, useRef, useState } from 'react'
import { Banner, Button, LinkButton, Switch, useKumoToastManager } from '@cloudflare/kumo'
import { ArrowSquareOut, ArrowsClockwise, Warning } from '@phosphor-icons/react'
import type { RpcStub } from 'capnweb'
import { MAX_UPDATE_CHECK_INTERVAL_MINUTES, MAX_UPDATE_HOURS } from '@gadgets/workshop-shared/api'
import type { AdminApi, DeploymentUpdateStatus } from '@gadgets/workshop-shared/api'
import { rpcFailureDescription } from '../../rpcErrors'
import { formatFullTimestamp } from '../../utils/formatTimestamp'
import { DurationSetting } from '../../components/DurationSetting'
import { probeRouterTag } from './probeRouterTag'

type AdminUpdatesPanelProps = {
  admin: RpcStub<AdminApi>
  /** What the server last reported. */
  status: DeploymentUpdateStatus
  /** Re-read the update status after a change, so that the panel shows what the server holds. */
  onChanged: () => Promise<void>
}

const CARD = 'bg-kumo-elevated border border-kumo-line rounded-xl p-6'
const CHECKS_LABEL = '自动检查更新'
const CHECK_INTERVAL_LABEL = '检查更新间隔（分钟）'
const MINIMUM_AGE_LABEL = '版本发布后的最短等待时间（小时）'
const SNOOZE_LABEL = '关闭通知后隐藏时长（小时）'

// The link comes from the service that installed this deployment; anything but a web URL (a
// `javascript:` one, say) is not rendered as a link.
const webUrl = (raw: string): string | null => {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

const WORKER_LIST = new Intl.ListFormat('zh-CN', { type: 'conjunction' })

// The Workers the status names, in words: "backend", "router", or a gatekeeper's install slug.
const workerList = (workers: string[]): string =>
  WORKER_LIST.format(workers.map((worker) =>
    worker === 'backend' ? '后端' : worker === 'router' ? '路由器' : `“${worker}”连接服务`))

const updateAvailability = (status: DeploymentUpdateStatus): string => {
  if (status.updateAvailable) return '是'
  return status.checkedAt === undefined ? '检查成功后才能确定' : '否'
}

// What a check found, announced since the rows it changes are not a live region.
const checkOutcome = (status: DeploymentUpdateStatus): string =>
  status.updateAvailable && status.latestReleaseId !== undefined
    ? `有可用更新：版本 ${status.latestReleaseId}`
    : '没有可用更新：此部署运行的是最新版本'

/** The admin Updates tab: which release this deployment runs, the newest one, and a way to update. */
export const AdminUpdatesPanel = ({ admin, status, onChanged }: AdminUpdatesPanelProps) => {
  const toasts = useKumoToastManager()
  const [savingChecks, setSavingChecks] = useState(false)
  // A switch value the server took, shown while `status` is the one it was written over: after a
  // write whose re-read failed, `status` is stale. Any later status replaces it.
  const [writtenChecks, setWrittenChecks] =
    useState<{ enabled: boolean; over: DeploymentUpdateStatus } | null>(null)
  const checksEnabled = writtenChecks?.over === status ? writtenChecks.enabled : status.checksEnabled
  const [checking, setChecking] = useState(false)
  const checksHelp = useId()
  const updateUrl = webUrl(status.updateUrl)
  // The switch and Check now are disabled while their call is in flight, and a browser takes focus
  // from a control that becomes disabled without giving it back. So the control that had focus
  // when the last call began gets it again once no call is in flight, unless focus has gone
  // elsewhere since.
  const busy = savingChecks || checking
  const focusBeforeCall = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (busy) return
    if (document.activeElement === document.body) focusBeforeCall.current?.focus()
    focusBeforeCall.current = null
  }, [busy])
  const rememberFocus = () => {
    focusBeforeCall.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  const reportFailure = (title: string, err: unknown) => {
    console.error(`${title}:`, err)
    toasts.add({ title, description: rpcFailureDescription(err), variant: 'error' })
  }

  // Resolves whether `op` went through and the status was re-read after it. A failed re-read is
  // reported on its own, since the change before it did go through.
  const change = async (failureTitle: string, op: () => Promise<unknown>): Promise<boolean> => {
    try {
      await op()
    } catch (err) {
      reportFailure(failureTitle, err)
      return false
    }
    try {
      await onChanged()
      return true
    } catch (err) {
      reportFailure('无法重新加载更新状态', err)
      return false
    }
  }

  const changeChecksEnabled = async (enabled: boolean) => {
    rememberFocus()
    setSavingChecks(true)
    try {
      const reread = await change(`无法更新“${CHECKS_LABEL}”`, async () => {
        await admin.setUpdateChecksEnabled(enabled)
        setWrittenChecks({ enabled, over: status })
      })
      if (reread) setWrittenChecks(null)
    } finally {
      setSavingChecks(false)
    }
  }

  const checkNow = async () => {
    rememberFocus()
    setChecking(true)
    try {
      await change('无法检查更新', async () => {
        await probeRouterTag()
        const checked = await admin.checkForUpdates()
        if (checked !== null) toasts.add({ title: checkOutcome(checked), variant: 'success' })
      })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-6">
      {status.modified && (
        <Banner
          role="alert"
          variant="error"
          icon={<Warning />}
          title="此部署在部署流程外发生了更改"
          description={
            `以下组件运行的版本与部署流程安装的版本不一致：${workerList(status.modifiedWorkers)}。撤销这些更改前，部署流程将拒绝升级。`
          }
        />
      )}

      <div className={CARD}>
        <h2 className="text-lg font-semibold text-kumo-strong mb-1">版本</h2>
        <p className="text-sm text-kumo-subtle mb-5">
          新版本通过部署流程安装，任何有权访问此部署的 Cloudflare 账号的人都可以完成升级。
        </p>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-kumo-subtle">当前版本</dt>
          <dd className="font-mono text-kumo-default">{status.currentReleaseId}</dd>
          <dt className="text-kumo-subtle">最新版本</dt>
          <dd className={status.latestReleaseId === undefined ? 'text-kumo-default' : 'font-mono text-kumo-default'}>
            {status.latestReleaseId ?? '尚无成功的检查'}
          </dd>
          <dt className="text-kumo-subtle">上次检查</dt>
          <dd className="text-kumo-default">
            {status.checkedAt === undefined ? '从未' : formatFullTimestamp(status.checkedAt)}
          </dd>
          <dt className="text-kumo-subtle">有可用更新</dt>
          <dd className="text-kumo-default">{updateAvailability(status)}</dd>
        </dl>

        {status.unfinishedWorkers.length > 0 && (
          <Banner
            variant="alert"
            icon={<ArrowsClockwise />}
            className="mt-4"
            title="更新未完成"
            description={
              `以下组件仍在运行此部署的其他版本：${workerList(status.unfinishedWorkers)}。` +
              (status.modifiedWorkers.length > 0
                ? '恢复在部署流程外更改的 Worker 后，即可通过部署流程完成更新。'
                : '可通过部署流程完成更新。')
            }
          />
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 mt-4">
          <Button variant="secondary" size="sm" loading={checking} disabled={checking} onClick={checkNow}>
            立即检查
          </Button>
          {updateUrl !== null && (
            <LinkButton href={updateUrl} external variant="primary" size="sm" icon={ArrowSquareOut}>
              更新
            </LinkButton>
          )}
        </div>
      </div>

      <div className={CARD}>
        <h2 className="text-lg font-semibold text-kumo-strong mb-1">更新通知</h2>
        <p className="text-sm text-kumo-subtle mb-5">
          有新版本时，管理员会在首页看到通知。这些设置适用于整个部署。
        </p>

        <div className="flex items-center gap-4 rounded-lg border border-kumo-line bg-kumo-base px-4 py-3 mb-5">
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium text-kumo-default">{CHECKS_LABEL}</p>
            <p id={checksHelp} className="mt-0.5 text-kumo-subtle">
              启用后，管理员使用时会按下方设定的最短间隔检查新版本并接收更新通知。关闭后，仅在管理员点击“立即检查”时检查，且不会发送通知。
            </p>
          </div>
          <Switch
            aria-label={CHECKS_LABEL}
            aria-describedby={checksHelp}
            checked={checksEnabled}
            disabled={savingChecks}
            onCheckedChange={changeChecksEnabled}
          />
        </div>

        <div className="grid items-start gap-6 sm:grid-cols-2">
          <DurationSetting
            label={CHECK_INTERVAL_LABEL}
            help={
              '两次检查之间依赖上次成功结果的最短时间。仅在管理员打开首页或这些设置时检查，不按计划执行。'
            }
            unit="minutes"
            min={1}
            max={MAX_UPDATE_CHECK_INTERVAL_MINUTES}
            value={status.checkIntervalMinutes}
            onSave={(minutes) =>
              change(`无法更新“${CHECK_INTERVAL_LABEL}”`, () => admin.setUpdateCheckIntervalMinutes(minutes))}
          />
          <DurationSetting
            label={MINIMUM_AGE_LABEL}
            help={
              '新版本发布后等待多久再通知管理员。这只会延迟通知，更新始终安装最新版本。设为 0 时，检查发现更新后立即通知。'
            }
            unit="hours"
            min={0}
            max={MAX_UPDATE_HOURS}
            value={status.minimumAgeHours}
            onSave={(hours) =>
              change(`无法更新“${MINIMUM_AGE_LABEL}”`, () => admin.setUpdateMinimumAgeHours(hours))}
          />
          <DurationSetting
            label={SNOOZE_LABEL}
            help={
              '关闭通知后在当前浏览器中隐藏的时间。设为 0 时，下次访问首页会再次显示。'
            }
            unit="hours"
            min={0}
            max={MAX_UPDATE_HOURS}
            value={status.noticeSnoozeHours}
            onSave={(hours) =>
              change(`无法更新“${SNOOZE_LABEL}”`, () => admin.setUpdateNoticeSnoozeHours(hours))}
          />
        </div>
      </div>
    </div>
  )
}
