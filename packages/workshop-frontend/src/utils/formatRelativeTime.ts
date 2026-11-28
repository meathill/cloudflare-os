/**
 * Relative age in the compact form the activity surfaces use: "刚刚", "7 分钟前", "3 小时前",
 * "2 天前". Deliberately coarse — these timestamps say how stale something is, not when it
 * happened.
 */
export function formatRelativeTime(date: Date): string {
  const minutes = Math.floor(Math.max(0, Date.now() - new Date(date).getTime()) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}
