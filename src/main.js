import './style.css'
import { applyStoreLinks } from './storeLinks.js'
import { initShowcase } from './showcase.js'

// Reveal/point any Google Play buttons once their URL is configured (no-op
// while the Play listing is unset, keeping those buttons hidden site-wide).
applyStoreLinks()

// Live showcase widgets (agent console, fusion panel, glucose lab, count-ups,
// spotlight). Every init is null-guarded, so pages without the markup no-op.
initShowcase()

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible')
        revealObserver.unobserve(entry.target)
      }
    })
  },
  { threshold: 0.05, rootMargin: '0px 0px -10px 0px' }
)

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el))

const nav = document.getElementById('nav')
window.addEventListener('scroll', () => {
  if (window.scrollY > 40) {
    nav.style.borderColor = 'rgba(255,255,255,0.04)'
  } else {
    nav.style.borderColor = 'transparent'
  }
}, { passive: true })

const menuBtn = document.getElementById('mobile-menu-btn')
const mobileMenu = document.getElementById('mobile-menu')
menuBtn?.addEventListener('click', () => {
  mobileMenu.classList.toggle('hidden')
  menuBtn.setAttribute('aria-expanded', String(!mobileMenu.classList.contains('hidden')))
})
mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    mobileMenu.classList.add('hidden')
    menuBtn?.setAttribute('aria-expanded', 'false')
  })
})

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    const href = anchor.getAttribute('href')
    if (href === '#') return
    const target = document.querySelector(href)
    if (target) {
      e.preventDefault()
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  })
})

// "/hardware" is a real, shareable URL that maps to the homepage hardware
// section. When the section is present we scroll to it smoothly and reflect the
// path without a full reload; a direct visit (served via rewrite) lands on the
// section. Links fall back to a normal navigation when the section is absent.
const hardwareSection = document.getElementById('hardware')
if (hardwareSection) {
  document.querySelectorAll('a[href="/hardware"]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault()
      hardwareSection.scrollIntoView({ behavior: 'smooth', block: 'start' })
      history.pushState(null, '', '/hardware')
    })
  })

  if (/^\/hardware\/?$/.test(window.location.pathname)) {
    const jumpToHardware = () => hardwareSection.scrollIntoView({ block: 'start' })
    jumpToHardware()
    window.addEventListener('load', jumpToHardware)
  }
}
