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

/* ---------- Viewport-aware media and ambient motion ---------- */
function initViewportVideos() {
  const videos = Array.from(document.querySelectorAll('video[data-viewport-video]'))
  if (!videos.length) return

  const visibleVideos = new Set()
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  let saveData = Boolean(connection?.saveData)
  let lowBattery = false
  let batteryReady = typeof navigator.getBattery !== 'function'

  const powerConstrained = () => reducedMotion || saveData || lowBattery
  const showPowerPoster = (video) => {
    if (!video.hasAttribute('data-power-poster')) return
    const posterTime = Number(video.dataset.posterTime || 0)
    const seek = () => {
      if (Number.isFinite(posterTime)) video.currentTime = posterTime
    }
    if (video.readyState >= 1) seek()
    else video.addEventListener('loadedmetadata', seek, { once: true })
  }
  const pause = (video, showPoster = false) => {
    video.pause()
    if (showPoster) showPowerPoster(video)
  }
  const play = (video) => {
    if (document.hidden || !batteryReady || powerConstrained()) return
    const promise = video.play()
    promise?.catch(() => {})
  }
  const syncVisibleVideos = () => {
    visibleVideos.forEach((video) => {
      if (powerConstrained()) pause(video, true)
      else play(video)
    })
  }

  videos.forEach((video) => pause(video))
  if (reducedMotion || !('IntersectionObserver' in window)) return

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          visibleVideos.add(entry.target)
          if (powerConstrained()) pause(entry.target, true)
          else play(entry.target)
        } else {
          visibleVideos.delete(entry.target)
          pause(entry.target)
        }
      })
    },
    { threshold: 0.18, rootMargin: '100px 0px' }
  )

  videos.forEach((video) => io.observe(video))
  document.addEventListener('visibilitychange', () => {
    videos.forEach((video) => pause(video))
    if (!document.hidden) syncVisibleVideos()
  })

  connection?.addEventListener?.('change', () => {
    saveData = Boolean(connection.saveData)
    syncVisibleVideos()
  })

  if (typeof navigator.getBattery === 'function') {
    navigator.getBattery()
      .then((battery) => {
        const updateBattery = () => {
          lowBattery = !battery.charging && battery.level <= 0.2
          batteryReady = true
          syncVisibleVideos()
        }
        battery.addEventListener('chargingchange', updateBattery)
        battery.addEventListener('levelchange', updateBattery)
        updateBattery()
      })
      .catch(() => {
        batteryReady = true
        syncVisibleVideos()
      })
  }
}

function initViewportMotion() {
  const targets = document.querySelectorAll('.hero-section, .fusion-panel, .dd-strip, .cta-card--aurora')
  if (!targets.length || reducedMotion || !('IntersectionObserver' in window)) return

  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => entry.target.classList.toggle('motion-active', entry.isIntersecting))
    },
    { threshold: 0.08, rootMargin: '120px 0px' }
  )
  targets.forEach((target) => io.observe(target))
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
    let timer = null
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const start = () => {
      if (timer) return
      timer = setInterval(() => {
        items[idx].classList.remove('on')
        idx = (idx + 1) % items.length
        items[idx].classList.add('on')
      }, 5200)
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) start()
        else stop()
      },
      { threshold: 0.2 }
    )
    io.observe(rot)
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
  const durations = rows.map((_, i) => (i === rows.length - 1 ? 0 : 2100))
  let idx = -1
  let timer = null
  let started = false
  let finished = false

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const advance = () => {
    timer = null
    if (idx >= 0) rows[idx].classList.remove('is-on')
    idx += 1
    if (idx >= rows.length) {
      finished = true
      return
    }
    rows[idx].classList.add('is-on')
    if (idx === rows.length - 1) {
      finished = true
      return
    }
    timer = setTimeout(advance, durations[idx])
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        if (!started) {
          started = true
          panel.classList.add('is-live')
          rows.forEach((row) => row.classList.remove('timeline-row--active'))
          advance()
        } else if (!finished && !timer) {
          timer = setTimeout(advance, 300)
        }
      } else {
        stop()
      }
    },
    { threshold: 0.35 }
  )
  io.observe(panel)
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

  let stageIdx = -1
  let timer = null
  let started = false
  let finished = false

  const applyStage = (stage) => {
    nodes.forEach((n, i) => n.classList.toggle('is-hot', i === stage.node))
    if (confEl) confEl.dataset.tier = String(stage.tier)
    if (confLabel) confLabel.textContent = stage.label
    if (deltaEl) deltaEl.textContent = stage.delta
    if (kcalEl) kcalEl.textContent = formatNumber(stage.kcal, 0)
  }

  const stop = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  const advance = () => {
    timer = null
    stageIdx += 1
    if (stageIdx >= stages.length) {
      finished = true
      return
    }
    applyStage(stages[stageIdx])
    if (stageIdx === stages.length - 1) {
      finished = true
      return
    }
    timer = setTimeout(advance, 3400)
  }

  const io = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        if (!started) {
          started = true
          advance()
        } else if (!finished && !timer) {
          timer = setTimeout(advance, 300)
        }
      } else {
        stop()
      }
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
  let autoComplete = false
  let autoTimer = null
  const stopAuto = () => {
    if (autoTimer) clearTimeout(autoTimer)
    autoTimer = null
  }

  buttons.forEach((b) => {
    b.addEventListener('click', () => {
      userLocked = true
      stopAuto()
      setMeal(parseInt(b.dataset.meal, 10))
    })
  })

  if (!reducedMotion) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !userLocked && !autoComplete && !autoTimer) {
          autoTimer = setTimeout(() => {
            autoTimer = null
            autoComplete = true
            if (!userLocked) setMeal(1)
          }, 4200)
        } else if (!entry.isIntersecting) {
          stopAuto()
        }
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
  const initializers = [
    initViewportVideos,
    initViewportMotion,
    initCountUps,
    initHeroRing,
    initRotators,
    initTilt,
    initStatementSweep,
    initTimeline,
    initFusion,
    initGlucoseLab,
    initSpotlight,
    initNavProgress,
  ]

  initializers.forEach((initialize) => {
    try {
      initialize()
    } catch (error) {
      console.error(`StatsKey showcase widget failed: ${initialize.name}`, error)
    }
  })
}
