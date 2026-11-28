// Locale-aware timestamp formatting for chat UI tooltips.
//
// The formatter instance is cached at module scope because constructing `Intl.DateTimeFormat` is
// surprisingly expensive and a chat view can render hundreds of timestamps.

let fullTimestampFormatter: Intl.DateTimeFormat | null = null;

function getFullTimestampFormatter(): Intl.DateTimeFormat {
  if (fullTimestampFormatter === null) {
    fullTimestampFormatter = new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "short",
      timeStyle: "short",
    });
  }
  return fullTimestampFormatter;
}

export function formatFullTimestamp(date: Date): string {
  return getFullTimestampFormatter().format(date);
}
