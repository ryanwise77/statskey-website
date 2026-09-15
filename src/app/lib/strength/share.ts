import {
  completedExercises,
  loadDisplay,
  setDescription,
  strengthTotals,
  type StrengthSession,
} from './model.ts'
export interface ShareRow {
  heading?: string
  text: string
}
export function strengthSharePages(
  session: StrengthSession,
  imperial: boolean,
): ShareRow[][] {
  const pages: ShareRow[][] = [],
    capacity = 28
  let page: ShareRow[] = []
  for (const entry of completedExercises(session)) {
    for (const set of entry.sets) {
      if (page.length >= capacity) {
        pages.push(page)
        page = []
      }
      page.push({
        heading:
          page.length === 0 || set.id === entry.sets[0]?.id
            ? entry.name
            : undefined,
        text: `Set ${set.number}  ·  ${setDescription(set, entry, imperial)}`,
      })
    }
  }
  if (page.length || !pages.length) pages.push(page)
  return pages
}
export function wrapShareText(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    if (line && measure(`${line} ${word}`) > width) {
      lines.push(line)
      line = ''
    }
    if (measure(word) > width) {
      if (line) {
        lines.push(line)
        line = ''
      }
      for (const char of Array.from(word)) {
        if (line && measure(line + char) > width) {
          lines.push(line)
          line = ''
        }
        line += char
      }
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}
export async function renderStrengthImages(
  session: StrengthSession,
  imperial: boolean,
): Promise<Blob[]> {
  const pages = strengthSharePages(session, imperial),
    totals = strengthTotals(session)
  const font = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  const images: Blob[] = []
  for (let index = 0; index < pages.length; index++) {
    const canvas = document.createElement('canvas'),
      context = canvas.getContext('2d')
    if (!context) throw new Error('Your browser cannot create a workout image.')
    const commands: Array<{
      text: string
      x: number
      y: number
      font: string
      color: string
    }> = []
    let y = 38
    function text(
      value: string,
      size: number,
      weight = 400,
      color = '#555',
      spacing = 8,
    ) {
      const style = `${weight} ${size}px ${font}`
      context!.font = style
      for (const line of wrapShareText(
        value,
        492,
        (str) => context!.measureText(str).width,
      )) {
        commands.push({ text: line, x: 24, y, font: style, color })
        y += size * 1.35
      }
      y += spacing
    }
    text('STRENGTH', 13, 750, '#ff4757', 12)
    text(session.title, 30, 750, '#111', 3)
    text(session.startDate.toLocaleString(), 14, 400, '#777', 17)
    text(
      `${totals.exercises} exercises   ·   ${totals.sets} completed sets`,
      18,
      650,
      '#111',
    )
    if (totals.volumeLbs > 0)
      text(
        `Working load volume: ${loadDisplay(totals.volumeLbs, imperial)}`,
        14,
      )
    if (session.endDate)
      text(
        `Duration: ${Math.round((session.endDate.getTime() - session.startDate.getTime()) / 60_000)} min`,
        14,
      )
    y += 10
    for (const row of pages[index]) {
      if (row.heading) {
        y += 14
        text(row.heading, 19, 700, '#111', 5)
      }
      text(row.text, 16, 400, '#333', 7)
    }
    y += 20
    text(
      `StatsKey${pages.length > 1 ? `  ·  ${index + 1} / ${pages.length}` : ''}`,
      14,
      700,
      '#888',
    )
    canvas.width = 1080
    canvas.height = Math.ceil((y + 12) * 2)
    context.scale(2, 2)
    context.fillStyle = '#fff'
    context.fillRect(0, 0, 540, y + 12)
    for (const command of commands) {
      context.font = command.font
      context.fillStyle = command.color
      context.fillText(command.text, command.x, command.y)
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (result) =>
          result
            ? resolve(result)
            : reject(new Error('Couldn’t create the image. Try again.')),
        'image/png',
      ),
    )
    images.push(blob)
  }
  return images
}
