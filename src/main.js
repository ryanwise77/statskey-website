import './style.css'
import { applyStoreLinks } from './storeLinks.js'
import { initShowcase } from './showcase.js'

// Reveal/point any Google Play buttons once their URL is configured (no-op
// while the Play listing is unset, keeping those buttons hidden site-wide).
applyStoreLinks()

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const revealEls = Array.from(document.querySelectorAll('.reveal'))

// Reveals are progressive enhancement: content is visible by default and is
// hidden only after the observer has been constructed successfully.
if (!prefersReducedMotion && 'IntersectionObserver' in window) {
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

  document.documentElement.classList.add('reveal-motion')
  revealEls.forEach((el) => revealObserver.observe(el))
}

// Showcase failures must never prevent navigation or leave page content hidden.
try {
  initShowcase()
} catch (error) {
  console.error('StatsKey showcase initialization failed', error)
}

const nav = document.getElementById('nav')
if (nav) {
  window.addEventListener('scroll', () => {
    if (window.scrollY > 40) {
      nav.style.borderColor = 'var(--line-soft)'
    } else {
      nav.style.borderColor = 'transparent'
    }
  }, { passive: true })
}

const menuBtn = document.getElementById('mobile-menu-btn')
const mobileMenu = document.getElementById('mobile-menu')
const menuLinks = Array.from(mobileMenu?.querySelectorAll('a') || [])
const pageRegions = [document.querySelector('main'), document.querySelector('.site-footer')].filter(Boolean)

if (menuBtn && mobileMenu) {
  menuBtn.setAttribute('aria-controls', mobileMenu.id)
  mobileMenu.setAttribute('role', 'navigation')
  mobileMenu.setAttribute('aria-label', 'Mobile navigation')
  mobileMenu.setAttribute('aria-hidden', String(mobileMenu.classList.contains('hidden')))
}

const setMobileMenuOpen = (isOpen) => {
  mobileMenu?.classList.toggle('hidden', !isOpen)
  mobileMenu?.setAttribute('aria-hidden', String(!isOpen))
  menuBtn?.setAttribute('aria-expanded', String(isOpen))
  menuBtn?.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu')
  document.body.classList.toggle('menu-open', isOpen)
  pageRegions.forEach((region) => { region.inert = isOpen })

  if (isOpen) {
    nav?.setAttribute('role', 'dialog')
    nav?.setAttribute('aria-modal', 'true')
    nav?.setAttribute('aria-label', 'Navigation menu')
    requestAnimationFrame(() => menuLinks[0]?.focus())
  } else {
    nav?.removeAttribute('role')
    nav?.removeAttribute('aria-modal')
    nav?.removeAttribute('aria-label')
  }
}

menuBtn?.addEventListener('click', () => {
  setMobileMenuOpen(menuBtn.getAttribute('aria-expanded') !== 'true')
})

menuLinks.forEach((link) => {
  link.addEventListener('click', () => {
    setMobileMenuOpen(false)
  })
})

document.addEventListener('keydown', (event) => {
  const menuOpen = menuBtn?.getAttribute('aria-expanded') === 'true'
  if (event.key === 'Escape' && menuOpen) {
    setMobileMenuOpen(false)
    menuBtn.focus()
  }

  if (event.key === 'Tab' && menuOpen) {
    const focusables = [menuBtn, ...menuLinks].filter(Boolean)
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
})

window.addEventListener('resize', () => {
  if (window.innerWidth > 1120 && menuBtn?.getAttribute('aria-expanded') === 'true') {
    setMobileMenuOpen(false)
  }
})

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    const href = anchor.getAttribute('href')
    if (href === '#') return
    const target = document.querySelector(href)
    if (target) {
      e.preventDefault()
      target.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
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
      hardwareSection.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
      history.pushState(null, '', '/hardware')
    })
  })

  if (/^\/hardware\/?$/.test(window.location.pathname)) {
    const jumpToHardware = () => hardwareSection.scrollIntoView({ block: 'start' })
    jumpToHardware()
    window.addEventListener('load', jumpToHardware)
  }
}

// The research section uses one lightweight live browser frame rather than six
// simultaneous embeds. Hover, focus, click, or arrow through the concept list
// to swap the actual destination page shown in the preview.
const conceptFrame = document.getElementById('concept-preview-frame')
const conceptViewport = document.getElementById('concept-preview-viewport')
const conceptOpen = document.getElementById('concept-open')
const conceptStatus = document.getElementById('concept-preview-status')
const conceptTitle = document.getElementById('concept-preview-title')
const conceptSummary = document.getElementById('concept-preview-summary')
const conceptOptions = Array.from(document.querySelectorAll('.concept-option'))

if (conceptFrame && conceptViewport && conceptOpen && conceptStatus && conceptTitle && conceptSummary && conceptOptions.length) {
  let previewTimer

  const selectConcept = (option) => {
    const previewUrl = option.dataset.preview
    const title = option.dataset.title
    if (!previewUrl || !title) return

    conceptOptions.forEach((candidate) => {
      const selected = candidate === option
      candidate.classList.toggle('is-active', selected)
      candidate.setAttribute('aria-selected', String(selected))
      candidate.tabIndex = selected ? 0 : -1
    })

    conceptOpen.href = option.dataset.href || previewUrl
    conceptStatus.textContent = option.dataset.status || 'Research concept'
    conceptTitle.textContent = title
    conceptSummary.textContent = option.dataset.summary || ''
    conceptFrame.title = `Live preview of the ${title} concept`

    const nextUrl = new URL(previewUrl, window.location.origin).href
    if (conceptFrame.src !== nextUrl) {
      conceptViewport.classList.add('is-loading')
      conceptFrame.src = previewUrl
    }
  }

  const queueConcept = (option, delay = 0) => {
    window.clearTimeout(previewTimer)
    previewTimer = window.setTimeout(() => selectConcept(option), delay)
  }

  const markConceptLoaded = () => {
    conceptViewport.classList.remove('is-loading')
  }

  conceptFrame.addEventListener('load', markConceptLoaded)
  if (conceptFrame.contentDocument?.readyState === 'complete') {
    window.requestAnimationFrame(markConceptLoaded)
  }

  conceptOptions.forEach((option, index) => {
    option.tabIndex = option.classList.contains('is-active') ? 0 : -1
    option.addEventListener('pointerenter', () => queueConcept(option, 90))
    option.addEventListener('focus', () => queueConcept(option))
    option.addEventListener('click', () => {
      queueConcept(option)
      if (window.matchMedia('(max-width: 1020px)').matches) {
        window.setTimeout(() => {
          conceptViewport.closest('.concept-live')?.scrollIntoView({
            behavior: prefersReducedMotion ? 'auto' : 'smooth',
            block: 'start'
          })
        }, 0)
      }
    })
    option.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()

      let nextIndex = index
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') nextIndex = (index + 1) % conceptOptions.length
      if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') nextIndex = (index - 1 + conceptOptions.length) % conceptOptions.length
      if (event.key === 'Home') nextIndex = 0
      if (event.key === 'End') nextIndex = conceptOptions.length - 1
      conceptOptions[nextIndex].focus()
    })
  })
}
