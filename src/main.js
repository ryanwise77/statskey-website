import './style.css'

// ─── Scroll Reveal ─────────────────────────────────────────────
const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible')
        revealObserver.unobserve(entry.target)
      }
    })
  },
  { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
)

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el))

// ─── Nav Scroll Behavior ───────────────────────────────────────
const nav = document.getElementById('nav')
let lastScroll = 0

window.addEventListener('scroll', () => {
  const scrollY = window.scrollY
  if (scrollY > 50) {
    nav.classList.add('border-border')
    nav.classList.remove('border-transparent')
  } else {
    nav.classList.remove('border-border')
    nav.classList.add('border-transparent')
  }
  lastScroll = scrollY
}, { passive: true })

// ─── Mobile Menu ───────────────────────────────────────────────
const menuBtn = document.getElementById('mobile-menu-btn')
const mobileMenu = document.getElementById('mobile-menu')

menuBtn?.addEventListener('click', () => {
  mobileMenu.classList.toggle('hidden')
})

mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => mobileMenu.classList.add('hidden'))
})

// ─── Smooth Scroll for Anchor Links ────────────────────────────
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'))
    if (target) {
      e.preventDefault()
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
})

// ─── Glucose Curve Canvas Animation ────────────────────────────
const canvas = document.getElementById('glucose-canvas')
if (canvas) {
  const ctx = canvas.getContext('2d')
  let animFrame
  let time = 0

  function resize() {
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.parentElement.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    canvas.style.width = rect.width + 'px'
    canvas.style.height = rect.height + 'px'
  }

  function drawCurve(yOffset, amplitude, frequency, speed, color, lineWidth) {
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    const midY = h * yOffset

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.lineWidth = lineWidth

    for (let x = 0; x <= w; x += 2) {
      const normalizedX = x / w
      const y =
        midY +
        Math.sin(normalizedX * Math.PI * frequency + time * speed) * amplitude +
        Math.sin(normalizedX * Math.PI * frequency * 2.3 + time * speed * 0.7) * (amplitude * 0.3) +
        Math.cos(normalizedX * Math.PI * frequency * 0.5 + time * speed * 1.3) * (amplitude * 0.2)

      if (x === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }

    ctx.stroke()
  }

  function animate() {
    const w = canvas.clientWidth
    const h = canvas.clientHeight

    ctx.clearRect(0, 0, w, h)

    drawCurve(0.35, 30, 2.5, 0.4, 'rgba(79, 124, 255, 0.25)', 1.5)
    drawCurve(0.5, 25, 3.0, 0.3, 'rgba(0, 212, 170, 0.2)', 1.5)
    drawCurve(0.65, 20, 2.0, 0.5, 'rgba(79, 124, 255, 0.12)', 1)

    // Faint grid dots
    const gridSize = 60
    for (let x = gridSize; x < w; x += gridSize) {
      for (let y = gridSize; y < h; y += gridSize) {
        const dist = Math.sqrt(
          Math.pow(x - w / 2, 2) + Math.pow(y - h / 2, 2)
        )
        const maxDist = Math.sqrt(Math.pow(w / 2, 2) + Math.pow(h / 2, 2))
        const opacity = Math.max(0, 0.15 - (dist / maxDist) * 0.15)

        ctx.beginPath()
        ctx.arc(x, y, 0.8, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(79, 124, 255, ${opacity})`
        ctx.fill()
      }
    }

    time += 0.016
    animFrame = requestAnimationFrame(animate)
  }

  resize()
  animate()

  window.addEventListener('resize', () => {
    cancelAnimationFrame(animFrame)
    resize()
    animate()
  })

  // Pause when not visible
  const heroObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry.isIntersecting) {
        animate()
      } else {
        cancelAnimationFrame(animFrame)
      }
    },
    { threshold: 0 }
  )
  heroObserver.observe(canvas.parentElement)
}
