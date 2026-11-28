import { Dialog } from '@cloudflare/kumo'
import { X } from '@phosphor-icons/react'
import { WorkshopButton, WorkshopIconButton } from '../../components/WorkshopControls'
import type { UnresolvedConflict } from './mergeConflicts'

type UnresolvedConflictsDialogProps = {
  /** The files that still hold conflict markers. Never empty. */
  conflicts: readonly UnresolvedConflict[]
  onCancel: () => void
  /** The user chose to accept the chat's changes with the markers in them. */
  onAcceptAnyway: () => void
}

/**
 * Stands between "Accept changes" and a draft whose merge conflicts are still marked in its
 * files. Accepting them as they are stays possible: the markers may be what the user wants to
 * keep working on outside this chat. Mount it while it should be open.
 *
 * TODO: Offer to open each file at its marker. The dialog names the file and the line, and
 * leaves finding them in the code view to the user. Nothing outside the code view can tell it
 * which file to show yet. Where two gadgets hold a file at the same path, the rows also look
 * alike: see the TODO in BlueprintProposalNotice.tsx on naming gadgets.
 */
export const UnresolvedConflictsDialog = ({
  conflicts,
  onCancel,
  onAcceptAnyway,
}: UnresolvedConflictsDialogProps) => (
  <Dialog.Root open onOpenChange={nextOpen => { if (!nextOpen) onCancel() }}>
    <Dialog
      className="!z-[1000] !top-[20%] !w-[min(440px,calc(100vw-32px))] !-translate-y-0 overflow-hidden bg-kumo-base p-0"
      size="sm"
    >
      <div className="flex items-start justify-between gap-4 border-b border-kumo-line px-5 py-4">
        <div className="min-w-0">
          <Dialog.Title className="text-[15px] leading-5 font-medium tracking-[-0.3px] text-kumo-default">
            此草稿仍有合并冲突
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-[12px] leading-4 font-normal tracking-[-0.2px] text-kumo-subtle">
            {conflicts.length === 1 ? '一个文件仍有' : `${conflicts.length} 个文件仍有`}{' '}
            处冲突标记；接受更改会将它们保留在应用中。请自行或让智能体在代码中解决冲突，然后再次接受。
          </Dialog.Description>
        </div>
        <Dialog.Close
          render={props => (
            <WorkshopIconButton {...props} className="!h-7 !w-7" aria-label="关闭">
              <X size={16} />
            </WorkshopIconButton>
          )}
        />
      </div>

      <ul className="m-0 max-h-[40vh] list-none space-y-1 overflow-y-auto px-5 py-3">
        {conflicts.map(conflict => (
          <li
            key={`${conflict.workpieceId}:${conflict.path}`}
            className="flex items-baseline justify-between gap-3 text-[12px] leading-[18px] text-kumo-default"
          >
            <span className="min-w-0 break-all font-mono">{conflict.path}</span>
            <span className="flex-shrink-0 text-kumo-subtle">行 {conflict.line}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-center justify-end gap-2 border-t border-kumo-line bg-kumo-base px-5 py-3">
        <WorkshopButton className="!h-9" onClick={onAcceptAnyway}>
          仍然接受
        </WorkshopButton>
        <WorkshopButton tone="primary" className="!h-9" onClick={onCancel}>
          继续解决
        </WorkshopButton>
      </div>
    </Dialog>
  </Dialog.Root>
)
