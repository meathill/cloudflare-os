/** Formats a timestamp as a compact age for skill-row metadata. */
export const formatSkillUpdatedAt = (date: Date, now = Date.now()): string => {
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days} 天前`;
  return `${Math.floor(days / 365)} 年前`;
};

/** Describes a skill timestamp without relying on compact-unit abbreviations. */
export const skillUpdatedAtLabel = (date: Date, now = Date.now()): string => {
  const minutes = Math.max(0, Math.floor((now - date.getTime()) / 60_000));
  if (minutes < 1) return "刚刚更新";
  if (minutes < 60) return `${minutes} 分钟前更新`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前更新`;
  const days = Math.floor(hours / 24);
  if (days < 365) return `${days} 天前更新`;
  const years = Math.floor(days / 365);
  return `${years} 年前更新`;
};
