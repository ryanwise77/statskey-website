// Showcase layer: scripted intelligence console, signal fusion, glucose lab,
// count-ups, and pointer-driven polish for the marketing pages. Everything is
// null-guarded so pages without these elements (legal, support) no-op, and
// everything defers to prefers-reduced-motion (static HTML already renders the
// finished state without JS).

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const finePointer = window.matchMedia('(pointer: fine)').matches

const easeOut = (t) => 1 - Math.pow(1 - t, 3)

function tween(duration, onFrame, onDone) {
  const start = performance.now()
  const frame = (now) => {
    const t = Math.min(1, (now - start) / duration)
    onFrame(easeOut(t))
    if (t < 1) requestAnimationFrame(frame)
    else if (onDone) onDone()
  }
  requestAnimationFrame(frame)
}

function formatNumber(value, decimals) {
  const fixed = value.toFixed(decimals)
  const [int, frac] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return frac ? `${grouped}.${frac}` : grouped
}

/* ---------- Count-up numbers ---------- */
function initCountUps() {
  const els = document.querySelectorAll('[data-count-to]')
  if (!els.length || reducedMotion) return
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        io.unobserve(entry.target)
        const el = entry.target
        const to = parseFloat(el.dataset.countTo)
        const decimals = parseInt(el.dataset.countDecimals || '0', 10)
        const prefix = el.dataset.countPrefix || ''
        const suffix = el.dataset.countSuffix || ''
        const dur = parseInt(el.dataset.countDur || '1300', 10)
        tween(dur, (t) => {
          el.textContent = `${prefix}${formatNumber(to * t, decimals)}${suffix}`
        })
      })
    },
    { threshold: 0.4 }
  )
  els.forEach((el) => io.observe(el))
}

/* ---------- Hero readiness ring sweep ---------- */
function initHeroRing() {
  const ring = document.getElementById('hero-ring')
  if (!ring || reducedMotion) return
  const paint = (pct) => {
    ring.style.background =
      `conic-gradient(from 160deg, var(--cyan), var(--blue) ${pct}%, ` +
      `rgba(255, 255, 255, 0.08) ${pct}%, rgba(255, 255, 255, 0.08)), rgba(255, 255, 255, 0.035)`
  }
  paint(0)
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      tween(1600, (t) => paint(72 * t))
    },
    { threshold: 0.4 }
  )
  io.observe(ring)
}

/* ---------- Hero insight rotator ---------- */
function initRotators() {
  document.querySelectorAll('[data-rotator]').forEach((rot) => {
    const items = Array.from(rot.querySelectorAll('.rot-item'))
    if (items.length < 2 || reducedMotion) return
    let idx = 0
    setInterval(() => {
      items[idx].classList.remove('on')
      idx = (idx + 1) % items.length
      items[idx].classList.add('on')
    }, 5200)
  })
}

/* ---------- Hero card tilt ---------- */
function initTilt() {
  const card = document.getElementById('hero-card')
  if (!card || reducedMotion || !finePointer) return
  const MAX = 6
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width - 0.5
    const py = (e.clientY - r.top) / r.height - 0.5
    card.classList.add('is-tilting')
    card.style.transform = `perspective(1100px) rotateY(${px * MAX}deg) rotateX(${-py * MAX}deg)`
  })
  card.addEventListener('pointerleave', () => {
    card.classList.remove('is-tilting')
    card.style.transition = 'transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)'
    card.style.transform = 'perspective(1100px) rotateY(0deg) rotateX(0deg)'
    setTimeout(() => { card.style.transition = '' }, 520)
  })
}

/* ---------- Statement word sweep ---------- */
function initStatementSweep() {
  const el = document.querySelector('[data-sweep]')
  if (!el) return
  const words = el.textContent.trim().split(/\s+/)
  if (reducedMotion) return
  el.innerHTML = words.map((w) => `<span class="sweep-word">${w}</span>`).join(' ')
  const spans = Array.from(el.querySelectorAll('.sweep-word'))
  let ticking = false
  const update = () => {
    ticking = false
    const rect = el.getBoundingClientRect()
    const vh = window.innerHeight
    const progress = Math.min(1, Math.max(0, (vh * 0.86 - rect.top) / (rect.height + vh * 0.42)))
    const lit = Math.round(progress * spans.length)
    spans.forEach((s, i) => s.classList.toggle('lit', i < lit))
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update) }
  }, { passive: true })
  update()
}

/* ---------- Live day timeline ---------- */
function initTimeline() {
  const panel = document.querySelector('#intelligence .timeline-panel')
  if (!panel || reducedMotion) return
  const rows = Array.from(panel.querySelectorAll('.timeline-row'))
  if (rows.length < 2) return
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      panel.classList.add('is-live')
      rows.forEach((r) => r.classList.remove('timeline-row--active'))
      const durations = rows.map((_, i) => (i === rows.length - 1 ? 3800 : 2100))
      let idx = -1
      const step = () => {
        if (idx >= 0) rows[idx].classList.remove('is-on')
        idx = (idx + 1) % rows.length
        rows[idx].classList.add('is-on')
        setTimeout(step, durations[idx])
      }
      step()
    },
    { threshold: 0.35 }
  )
  io.observe(panel)
}

/* ---------- Agent console script ---------- */
function initAgentConsole() {
  const consoleEl = document.getElementById('agent-console')
  if (!consoleEl || reducedMotion) return
  const body = document.getElementById('ac-body')
  const modelEl = document.getElementById('ac-model')
  const steps = Array.from(body.children)
  const tools = steps.filter((el) => el.classList.contains('ac-tool'))
  const models = ['Auto · frontier routing', 'Claude Opus', 'Gemini', 'OpenAI', 'Grok']
  let modelIdx = 0

  consoleEl.classList.add('is-scripted')
  steps.forEach((el) => el.classList.add('ac-step'))

  const timers = new Set()
  const after = (ms, fn) => {
    const id = setTimeout(() => { timers.delete(id); fn() }, ms)
    timers.add(id)
  }

  const play = () => {
    steps.forEach((el) => el.classList.remove('is-in'))
    tools.forEach((el) => el.classList.remove('is-running', 'is-done'))
    if (modelEl) modelEl.textContent = models[modelIdx % models.length]
    modelIdx += 1

    let t = 350
    steps.forEach((el) => {
      if (el.classList.contains('ac-tool')) {
        const showAt = t
        after(showAt, () => { el.classList.add('is-in', 'is-running') })
        after(showAt + 850, () => {
          el.classList.remove('is-running')
          el.classList.add('is-done')
        })
        t += 1000
      } else {
        after(t, () => el.classList.add('is-in'))
        t += el.classList.contains('ac-msg--ai') ? 900 : 750
      }
    })
    after(t + 4600, play)
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      play()
    },
    { threshold: 0.3 }
  )
  io.observe(consoleEl)
}

/* ---------- Adaptive Intelligence fusion panel ---------- */
function initFusion() {
  const panel = document.getElementById('fusion-panel')
  if (!panel) return

  if (reducedMotion) return

  // Traveling pulses along the wires (CSS-animated path clones).
  const svg = panel.querySelector('.fusion-wires')
  if (svg) {
    Array.from(svg.querySelectorAll('path')).forEach((path) => {
      const pulse = path.cloneNode()
      pulse.classList.add('wire-pulse')
      svg.appendChild(pulse)
    })
  }

  const kcalEl = document.getElementById('fusion-kcal')
  const deltaEl = document.getElementById('fusion-delta')
  const confEl = document.getElementById('fusion-conf')
  const confLabel = document.getElementById('fusion-conf-label')
  const nodes = Array.from(panel.querySelectorAll('.fusion-node'))

  const stages = [
    { kcal: 2847, delta: 'formula ensemble sets the baseline', tier: 1, label: 'Baseline confidence — formula ensemble', node: 0 },
    { kcal: 2878, delta: '30-day Watch activity: +31 kcal', tier: 2, label: 'Medium confidence — Watch activity corroborates', node: 1 },
    { kcal: 2872, delta: 'weight trend reconciles: −6 kcal', tier: 3, label: 'High confidence — cross-validated by your weight trend', node: 2 },
  ]

  let stageIdx = 0
  let currentKcal = stages[stages.length - 1].kcal

  const applyStage = (stage) => {
    nodes.forEach((n, i) => n.classList.toggle('is-hot', i === stage.node))
    if (confEl) confEl.dataset.tier = String(stage.tier)
    if (confLabel) confLabel.textContent = stage.label
    if (deltaEl) {
      deltaEl.classList.add('is-swap')
      setTimeout(() => {
        deltaEl.textContent = stage.delta
        deltaEl.classList.remove('is-swap')
      }, 300)
    }
    const from = currentKcal
    tween(800, (t) => {
      if (kcalEl) kcalEl.textContent = formatNumber(from + (stage.kcal - from) * t, 0)
    })
    currentKcal = stage.kcal
  }

  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      applyStage(stages[0])
      setInterval(() => {
        stageIdx = (stageIdx + 1) % stages.length
        applyStage(stages[stageIdx])
      }, 3400)
    },
    { threshold: 0.35 }
  )
  io.observe(panel)
}

/* ---------- Glucose response lab ---------- */
function initGlucoseLab() {
  const lab = document.getElementById('glucose-lab')
  if (!lab) return

  const line = document.getElementById('gl-line')
  const area = document.getElementById('gl-area')
  const dot = document.getElementById('gl-dot')
  const stats = {
    peak: document.getElementById('gl-peak'),
    iauc: document.getElementById('gl-iauc'),
    rec: document.getElementById('gl-rec'),
    dip: document.getElementById('gl-dip'),
  }
  if (!line || !area) return

  const W = 720
  const BASE_Y = 180
  const SCALE = 1.5 // px per mg/dL
  const MINUTES = 195
  const SAMPLES = 64

  // Each meal is a rise bump plus an optional reactive dip.
  const meals = [
    { rise: { center: 55, width: 26, amp: 52 }, dip: { center: 150, width: 30, amp: 14 }, peak: 52, iauc: 142, rec: 118, dipVal: 14 },
    { rise: { center: 72, width: 40, amp: 24 }, dip: { center: 160, width: 30, amp: 0 }, peak: 24, iauc: 61, rec: 74, dipVal: 0 },
  ]

  const valueAt = (m, minute) => {
    const bump = (b) => b.amp * Math.exp(-((minute - b.center) ** 2) / (2 * b.width ** 2))
    return bump(m.rise) - bump(m.dip)
  }

  const mix = (a, b, t) => a + (b - a) * t

  const paint = (blend, from, to) => {
    let d = ''
    let peakX = 0
    let peakY = BASE_Y
    for (let i = 0; i <= SAMPLES; i++) {
      const minute = (i / SAMPLES) * MINUTES
      const v = mix(valueAt(from, minute), valueAt(to, minute), blend)
      const x = (i / SAMPLES) * W
      const y = BASE_Y - v * SCALE
      d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ' ' + y.toFixed(1)
      if (y < peakY) { peakY = y; peakX = x }
    }
    line.setAttribute('d', d)
    area.setAttribute('d', d + `L${W} ${BASE_Y} L0 ${BASE_Y} Z`)
    if (dot) {
      dot.setAttribute('cx', peakX.toFixed(1))
      dot.setAttribute('cy', peakY.toFixed(1))
    }
  }

  const paintStats = (blend, from, to) => {
    const peak = Math.round(mix(from.peak, to.peak, blend))
    const iauc = Math.round(mix(from.iauc, to.iauc, blend))
    const rec = Math.round(mix(from.rec, to.rec, blend))
    const dipV = Math.round(mix(from.dipVal, to.dipVal, blend))
    if (stats.peak) stats.peak.textContent = `+${peak}`
    if (stats.iauc) stats.iauc.textContent = String(iauc)
    if (stats.rec) stats.rec.textContent = `${rec}m`
    if (stats.dip) stats.dip.textContent = dipV < 1 ? '—' : `−${dipV}`
  }

  let current = 0
  paint(0, meals[0], meals[0])
  paintStats(0, meals[0], meals[0])

  const buttons = Array.from(lab.querySelectorAll('.glucose-lab__toggle button'))
  const setMeal = (target) => {
    if (target === current) return
    const from = meals[current]
    const to = meals[target]
    current = target
    buttons.forEach((b) => {
      const on = parseInt(b.dataset.meal, 10) === target
      b.classList.toggle('on', on)
      b.setAttribute('aria-pressed', String(on))
    })
    if (reducedMotion) {
      paint(1, from, to)
      paintStats(1, from, to)
      return
    }
    tween(900, (t) => {
      paint(t, from, to)
      paintStats(t, from, to)
    })
  }

  let userLocked = false
  buttons.forEach((b) => {
    b.addEventListener('click', () => {
      userLocked = true
      setMeal(parseInt(b.dataset.meal, 10))
    })
  })

  if (!reducedMotion) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        setInterval(() => {
          if (!userLocked) setMeal((current + 1) % meals.length)
        }, 5600)
      },
      { threshold: 0.35 }
    )
    io.observe(lab)
  }
}

/* ---------- Pointer spotlight on cards ---------- */
function initSpotlight() {
  if (!finePointer || reducedMotion) return
  document.addEventListener('pointermove', (e) => {
    const card = e.target.closest?.('.feature-card, .lab-card, .cmp-col')
    if (!card) return
    const r = card.getBoundingClientRect()
    card.style.setProperty('--mx', `${e.clientX - r.left}px`)
    card.style.setProperty('--my', `${e.clientY - r.top}px`)
  }, { passive: true })
}

/* ---------- Nav reading progress ---------- */
function initNavProgress() {
  const nav = document.getElementById('nav')
  if (!nav || reducedMotion) return
  const bar = document.createElement('span')
  bar.className = 'nav-progress'
  bar.setAttribute('aria-hidden', 'true')
  nav.appendChild(bar)
  let ticking = false
  const update = () => {
    ticking = false
    const max = document.documentElement.scrollHeight - window.innerHeight
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, window.scrollY / max) : 0})`
  }
  window.addEventListener('scroll', () => {
    if (!ticking) { ticking = true; requestAnimationFrame(update) }
  }, { passive: true })
  update()
}

export function initShowcase() {
  initCountUps()
  initHeroRing()
  initRotators()
  initTilt()
  initStatementSweep()
  initTimeline()
  initAgentConsole()
  initFusion()
  initGlucoseLab()
  initSpotlight()
  initNavProgress()
}
