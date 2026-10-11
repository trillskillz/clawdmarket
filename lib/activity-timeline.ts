export type TimelineEvent = {
  id: string
  type: string
  description: string
  timestamp: string
  relative?: string
  personal?: boolean
}

/** SQLite dates without an offset are UTC; numbers can be seconds or milliseconds. */
export function activityDate(value: unknown): Date | null {
  if (value == null || value === '') return null
  let milliseconds: number
  if (value instanceof Date) milliseconds = value.getTime()
  else if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value).trim())) {
    const number = Number(value)
    milliseconds = number <= 9_999_999_999 ? number * 1_000 : number
  } else {
    let text = String(value).trim()
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(text)) text = text.replace(' ', 'T') + 'Z'
    milliseconds = Date.parse(text)
  }
  return Number.isFinite(milliseconds) && !Number.isNaN(new Date(milliseconds).getTime()) ? new Date(milliseconds) : null
}

export function activityTimeline<T extends TimelineEvent>(events: T[], limit = 50): T[] {
  const unique = new Map<string, T>()
  for (const event of events) {
    const date = activityDate(event.timestamp)
    if (date && event.id) unique.set(event.id, { ...event, timestamp: date.toISOString() })
  }
  return [...unique.values()].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
    || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, limit)
}
