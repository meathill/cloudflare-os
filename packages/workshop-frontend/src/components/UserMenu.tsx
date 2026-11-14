import { useNavigate } from '@tanstack/react-router'
import { DropdownMenu } from '@cloudflare/kumo'
import { useAuthenticatedApi } from '../AuthContext'
import { useAvatar } from '../useAvatar'
import { MENU_CONTENT, MENU_ITEM, MENU_ITEM_DANGER, MENU_POSITIONER_STYLE } from './menuStyles'
import { useBilling } from '../features/billing/BillingContext'
import { formatUsd } from '../features/billing/formatUsd'

export default function UserMenu() {
  const { authenticatedApi, logout, currentUser, isAdmin } = useAuthenticatedApi()
  const navigate = useNavigate()
  const billing = useBilling()

  const avatarUrl = useAvatar(authenticatedApi, currentUser?.id)

  const initials = currentUser?.name
    ? currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
    : 'U'

  return (
    <DropdownMenu>
      <DropdownMenu.Trigger
        render={
          <button
            className="flex h-11 w-11 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-kumo-tint transition-colors hover:bg-kumo-fill md:h-7 md:w-7"
            title="打开个人资料菜单"
            aria-label="打开个人资料菜单"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs font-medium text-kumo-strong">{initials}</span>
            )}
          </button>
        }
      />
      <DropdownMenu.Content className={MENU_CONTENT} style={MENU_POSITIONER_STYLE}>
        <DropdownMenu.Item
          onClick={() => navigate({ to: '/profile' })}
          className={MENU_ITEM}
        >
          个人资料
        </DropdownMenu.Item>
        {billing && (
          <DropdownMenu.Item
            onClick={() => navigate({ to: '/billing' })}
            className={MENU_ITEM}
          >
            余额与充值
            {billing.summary && (
              <span className="ml-auto pl-4 text-kumo-subtle">{formatUsd(billing.summary.balanceUsd)}</span>
            )}
          </DropdownMenu.Item>
        )}
        {isAdmin && (
          <DropdownMenu.Item
            onClick={() => navigate({ to: '/admin' })}
            className={MENU_ITEM}
          >
            管理后台
          </DropdownMenu.Item>
        )}
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          variant="danger"
          onClick={logout}
          className={MENU_ITEM_DANGER}
        >
          退出登录
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu>
  )
}
