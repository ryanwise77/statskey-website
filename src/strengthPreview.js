import { loadDisplay, setDescription } from './app/lib/strength/model.ts'
import { renderStrengthImages } from './app/lib/strength/share.ts'
import { recordedSetRange, videoTrimRange } from './app/lib/strength/video.ts'

// Public demonstration data. The homepage never requests a user's strength log.
const startDate = new Date('2026-09-12T17:00:00Z')
const at = (seconds) => new Date(startDate.getTime() + seconds * 1000)
const completedSet = (id, number, values) => ({
  id,
  number,
  setType: 'working',
  isCompleted: true,
  ...values,
})
export const strengthExample = {
  id: 'strength-homepage-example',
  userId: 'public-example',
  title: 'Example · Upper body A',
  startDate,
  endDate: at(42 * 60),
  createdAt: startDate,
  status: 'completed',
  recordingMode: 'live',
  notes: '',
  defaultRestSeconds: 120,
  edited: false,
  entries: [
    {
      id: 'example-bench',
      exerciseId: 'bb-bench-press',
      name: 'Bench press',
      equipment: 'barbell',
      measure: 'reps',
      sets: [
        completedSet('example-bench-1', 1, {
          loadKind: 'externalWeight',
          weightLbs: 95,
          reps: 10,
          setType: 'warmup',
          startedAt: at(18),
          completedAt: at(40),
        }),
        completedSet('example-bench-2', 2, {
          loadKind: 'externalWeight',
          weightLbs: 135,
          reps: 8,
          rpe: 8,
          startedAt: at(78),
          completedAt: at(102),
        }),
        completedSet('example-bench-3', 3, {
          loadKind: 'externalWeight',
          weightLbs: 135,
          reps: 6,
          rpe: 9,
          startedAt: at(135),
          completedAt: at(160),
        }),
      ],
    },
    {
      id: 'example-row',
      exerciseId: 'db-row',
      name: 'Dumbbell row',
      equipment: 'dumbbell',
      measure: 'reps',
      sets: [1, 2, 3].map((n) =>
        completedSet(`example-row-${n}`, n, {
          loadKind: 'externalWeight',
          weightLbs: 50,
          reps: 10,
        }),
      ),
    },
    {
      id: 'example-plank',
      exerciseId: 'bw-plank',
      name: 'Plank',
      equipment: 'bodyweight',
      measure: 'time',
      sets: [1, 2, 3].map((n) =>
        completedSet(`example-plank-${n}`, n, {
          loadKind: 'bodyweightOnly',
          durationSeconds: 45,
        }),
      ),
    },
  ],
}

export function exampleClip(index, shift = 0) {
  const set = strengthExample.entries[0].sets[index]
  if (!set || !Number.isFinite(shift)) return null
  const recorded = recordedSetRange(strengthExample, set)
  if (!recorded) return null
  return videoTrimRange(
    recorded[0],
    recorded[1],
    -Math.max(-8, Math.min(8, shift)),
    180,
  )
}
const clock = (seconds) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`

export function initStrengthPreview() {
  const root = document.querySelector('[data-strength-preview]')
  if (!root) return
  const find = (selector) => root.querySelector(selector)
  const setButtons = Array.from(root.querySelectorAll('[data-strength-set]'))
  const tabs = Array.from(root.querySelectorAll('[data-strength-tab]'))
  const units = find('[data-strength-units]')
  const offset = find('#strength-preview-offset')
  const image = find('[data-strength-image]')
  const imageStatus = find('[data-strength-image-status]')
  const download = find('[data-strength-image-download]')
  const imageJobs = new Map()
  const imageURLs = []
  let selected = 1,
    view = 'clip',
    request = 0,
    disposed = false
  const imperial = () => units.value !== 'kg'

  function render() {
    const entry = strengthExample.entries[0],
      set = entry.sets[selected]
    const range = exampleClip(selected, Number(offset.value))
    if (!range) return
    setButtons.forEach((button, index) => {
      button.setAttribute('aria-pressed', String(index === selected))
      button.querySelector('[data-strength-load]').textContent =
        `${loadDisplay(entry.sets[index].weightLbs, imperial())} × ${entry.sets[index].reps}`
    })
    find('[data-strength-row-load]').textContent = loadDisplay(50, imperial())
    find('[data-strength-set-title]').textContent = `Set ${set.number}`
    find('[data-strength-selected-load]').textContent = setDescription(
      set,
      entry,
      imperial(),
    )
    find('[data-strength-duration]').textContent = String(range[1] - range[0])
    find('[data-strength-range]').textContent =
      `${clock(range[0])} → ${clock(range[1])}`
    const selection = find('[data-strength-selection]')
    selection.style.left = `${(range[0] / 180) * 100}%`
    selection.style.width = `${((range[1] - range[0]) / 180) * 100}%`
    const shift = Number(offset.value)
    const delta =
      shift === 0
        ? 'Original timing'
        : `${Math.abs(shift)} seconds ${shift > 0 ? 'later' : 'earlier'}`
    find('[data-strength-offset-label]').textContent = delta
    offset.setAttribute('aria-valuetext', delta)
    find('.strength-preview-timeline').setAttribute(
      'aria-label',
      `Timing illustration. Set ${set.number}: selected clip ${clock(range[0])} to ${clock(range[1])}.`,
    )
  }

  async function prepareImage() {
    const ticket = ++request,
      useImperial = imperial()
    image.hidden = true
    download.hidden = true
    imageStatus.hidden = false
    imageStatus.textContent = 'Preparing the example workout image…'
    try {
      if (!imageJobs.has(useImperial)) {
        const job = renderStrengthImages(strengthExample, useImperial)
          .then((blobs) => {
            if (disposed) return null
            const url = URL.createObjectURL(blobs[0])
            imageURLs.push(url)
            return url
          })
          .catch((error) => {
            imageJobs.delete(useImperial)
            throw error
          })
        imageJobs.set(useImperial, job)
      }
      const url = await imageJobs.get(useImperial)
      if (disposed || ticket !== request || !url) return
      image.src = url
      image.hidden = false
      imageStatus.hidden = true
      download.href = url
      download.download = `StatsKey-example-strength-${useImperial ? 'lb' : 'kg'}.png`
      download.hidden = false
    } catch {
      if (disposed || ticket !== request) return
      imageStatus.textContent =
        'This browser could not prepare the image. Open Strength to try the sharing tools.'
    }
  }

  function selectView(next) {
    view = next
    tabs.forEach((tab) => {
      const active = tab.dataset.strengthTab === next
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      document.getElementById(tab.getAttribute('aria-controls')).hidden =
        !active
    })
    if (next === 'image') void prepareImage()
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectView(tab.dataset.strengthTab))
    tab.addEventListener('keydown', (event) => {
      let next
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
      if (event.key === 'ArrowLeft')
        next = (index - 1 + tabs.length) % tabs.length
      if (event.key === 'Home') next = 0
      if (event.key === 'End') next = tabs.length - 1
      if (next == null) return
      event.preventDefault()
      selectView(tabs[next].dataset.strengthTab)
      tabs[next].focus()
    })
  })
  setButtons.forEach((button, index) =>
    button.addEventListener('click', () => {
      selected = index
      offset.value = '0'
      render()
      selectView('clip')
    }),
  )
  units.addEventListener('change', () => {
    render()
    if (view === 'image') void prepareImage()
  })
  offset.addEventListener('input', render)
  find('[data-strength-reset]').addEventListener('click', () => {
    offset.value = '0'
    render()
  })
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return
    disposed = true
    request++
    imageURLs.forEach((url) => URL.revokeObjectURL(url))
  })
  render()
}
