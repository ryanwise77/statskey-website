// Stable display colors for calendar sources, in the shared contract shape:
// every source key maps to one entry of a fixed 8-color brand-adjacent
// palette (accent blue first), each pairing a soft tint background with a
// readable ink-dark foreground and a saturated dot. Built-in sources pin to
// stable brand-aligned entries; every other key (like `sub:<name>`) hashes
// deterministically, so the same calendar always renders the same color with
// no stored state.

export interface CalendarColor {
  bg: string
  fg: string
  dot: string
}

export const CALENDAR_COLOR_PALETTE: readonly CalendarColor[] = [
  { bg: '#e8f0fa', fg: '#004a94', dot: '#0066cc' }, // accent blue
  { bg: '#e3f4f2', fg: '#0b5d56', dot: '#0d9488' }, // teal
  { bg: '#f0eafc', fg: '#5b21b6', dot: '#7c3aed' }, // violet
  { bg: '#fdf1e0', fg: '#8a4a05', dot: '#d97706' }, // amber
  { bg: '#fce9ee', fg: '#9f1239', dot: '#e11d48' }, // rose
  { bg: '#e6f6ec', fg: '#166534', dot: '#16a34a' }, // green
  { bg: '#edf1f5', fg: '#3d4f63', dot: '#64748b' }, // slate
  { bg: '#e2f4f9', fg: '#0b5c72', dot: '#0891b2' }, // cyan
]

// Built-in sources keep one brand-adjacent color each: local stays on the
// accent blue, google reads violet, meals green, fitness cyan.
const PINNED_SOURCES: Record<string, number> = {
  local: 0,
  google: 2,
  meals: 5,
  fitness: 7,
}

export function calendarColor(sourceKey: string): CalendarColor {
  const pinned = PINNED_SOURCES[sourceKey]
  const index =
    pinned !== undefined
      ? pinned
      : hashKey(sourceKey) % CALENDAR_COLOR_PALETTE.length
  return { ...CALENDAR_COLOR_PALETTE[index] }
}

/** djb2 string hash, kept unsigned so the palette index is stable. */
function hashKey(value: string): number {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash
}
