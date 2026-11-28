import { useState } from 'react'
import { Tooltip, useKumoToastManager } from '@cloudflare/kumo'
import { ArrowClockwise } from '@phosphor-icons/react'
import { getSnapshotSharingErrorCode, SNAPSHOT_SHARING_ERROR_CODES } from '@gadgets/workshop-shared/api'
import { WorkshopIconButton } from './components/WorkshopControls'

type Props = {
  // Takes a new copy of the gadget (see GadgetSnapshotClient.refresh()) and shows it.
  onRefresh: () => Promise<void>
}

/** Takes a new snapshot of a gadget, spinning meanwhile and reporting a failure as a toast. */
export const SnapshotRefreshButton = ({ onRefresh }: Props) => {
  const [refreshing, setRefreshing] = useState(false)
  const toasts = useKumoToastManager()

  const refresh = async () => {
    setRefreshing(true)
    try {
      await onRefresh()
    } catch (error) {
      if (getSnapshotSharingErrorCode(error) === SNAPSHOT_SHARING_ERROR_CODES.disabled) {
        toasts.add({ title: '管理员已关闭应用快照分享。', variant: 'error' })
        return
      }
      console.error('Failed to refresh gadget snapshot:', error)
      toasts.add({ title: '刷新快照失败', variant: 'error' })
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <Tooltip content="刷新快照" asChild>
      <WorkshopIconButton aria-label="刷新快照" disabled={refreshing} onClick={refresh}>
        <ArrowClockwise size={17} className={refreshing ? 'animate-spin' : undefined} />
      </WorkshopIconButton>
    </Tooltip>
  )
}
