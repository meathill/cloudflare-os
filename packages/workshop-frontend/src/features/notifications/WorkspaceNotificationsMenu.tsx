import { DropdownMenu, useKumoToastManager } from '@cloudflare/kumo'
import { Bell, BellSlash } from '@phosphor-icons/react'
import type { NotificationMute } from '@gadgets/workshop-shared/api'
import { useAuthenticatedApi } from '../../AuthContext'
import { MENU_CONTENT, MENU_ITEM, MENU_POSITIONER_STYLE } from '../../components/menuStyles'
import { logRpcFailure } from '../../rpcErrors'
import { describeMute } from './notificationMute'

const hoursFromNow = (hours: number): NotificationMute =>
  ({ until: new Date(Date.now() + hours * 60 * 60_000) })

// Each choice computes its mute when picked; "end of day" is the user's next local midnight.
const MUTE_CHOICES: [label: string, mute: () => NotificationMute][] = [
  ['1 小时', () => hoursFromNow(1)],
  ['3 小时', () => hoursFromNow(3)],
  ['到今天结束', () => {
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 0)
    return { until: midnight }
  }],
  ['1 天', () => hoursFromNow(24)],
  ['3 天', () => hoursFromNow(3 * 24)],
  ['直到手动取消静音', () => ({ indefinite: true })],
]

/**
 * A workspace menu's notification control: a "Mute notifications" submenu of durations, or
 * "Unmute notifications" while a mute lasts. A mute silences finished tasks; permission requests
 * still come through. `onMuteChange` is called once the server has stored the change.
 */
export const WorkspaceNotificationsMenu = ({ workspaceId, mute, onMuteChange }: {
  workspaceId: string
  mute?: NotificationMute
  onMuteChange: (mute: NotificationMute | undefined) => void
}) => {
  const { authenticatedApi } = useAuthenticatedApi()
  const toasts = useKumoToastManager()

  const setMute = async (next: NotificationMute | undefined) => {
    try {
      await authenticatedApi.setWorkspaceNotificationMute(workspaceId, next ?? null)
      onMuteChange(next)
    } catch (error) {
      logRpcFailure('Failed to update workspace notifications:', error)
      toasts.add({ title: '更新通知失败', variant: 'error' })
    }
  }

  if (describeMute(mute)) {
    return (
      <DropdownMenu.Item onClick={() => setMute(undefined)} className={MENU_ITEM}>
        <Bell size={13} /> 取消静音通知
      </DropdownMenu.Item>
    )
  }

  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className={MENU_ITEM}>
        <BellSlash size={13} /> 静音通知
      </DropdownMenu.SubTrigger>
      <DropdownMenu.SubContent className={MENU_CONTENT} style={MENU_POSITIONER_STYLE}>
        <DropdownMenu.Group>
          <DropdownMenu.Label className="!px-2.5 !py-1.5 text-[12px] text-kumo-subtle">
            任务需要你的许可时仍会通知
          </DropdownMenu.Label>
          {MUTE_CHOICES.map(([label, choose]) => (
            <DropdownMenu.Item key={label} onClick={() => setMute(choose())} className={MENU_ITEM}>
              {label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Group>
      </DropdownMenu.SubContent>
    </DropdownMenu.Sub>
  )
}
