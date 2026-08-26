import './style.css'
import './network.css'
import { applyStoreLinks } from './storeLinks.js'

applyStoreLinks()

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const revealEls = Array.from(document.querySelectorAll('.reveal'))

if (!prefersReducedMotion && 'IntersectionObserver' in window) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      entry.target.classList.add('visible')
      revealObserver.unobserve(entry.target)
    })
  }, { threshold: 0.05, rootMargin: '0px 0px -10px 0px' })

  document.documentElement.classList.add('reveal-motion')
  revealEls.forEach((element) => revealObserver.observe(element))
}

const nav = document.getElementById('nav')
const navMenus = Array.from(document.querySelectorAll('.site-nav__menu'))

window.addEventListener('scroll', () => {
  if (!nav) return
  nav.style.borderColor = window.scrollY > 40 ? 'var(--line-soft)' : 'transparent'
}, { passive: true })

document.addEventListener('click', (event) => {
  navMenus.forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute('open')
  })
})

navMenus.forEach((menu) => {
  menu.addEventListener('toggle', () => {
    if (!menu.open) return
    navMenus.forEach((candidate) => {
      if (candidate !== menu) candidate.removeAttribute('open')
    })
  })
})

const menuBtn = document.getElementById('mobile-menu-btn')
const mobileMenu = document.getElementById('mobile-menu')
const menuLinks = Array.from(mobileMenu?.querySelectorAll('a') || [])
const pageRegions = [document.querySelector('main'), document.querySelector('.site-footer')].filter(Boolean)

const setMobileMenuOpen = (isOpen) => {
  mobileMenu?.classList.toggle('hidden', !isOpen)
  mobileMenu?.setAttribute('aria-hidden', String(!isOpen))
  menuBtn?.setAttribute('aria-expanded', String(isOpen))
  menuBtn?.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu')
  document.body.classList.toggle('menu-open', isOpen)
  pageRegions.forEach((region) => { region.inert = isOpen })
  if (isOpen) requestAnimationFrame(() => menuLinks[0]?.focus())
}

menuBtn?.addEventListener('click', () => {
  setMobileMenuOpen(menuBtn.getAttribute('aria-expanded') !== 'true')
})

menuLinks.forEach((link) => link.addEventListener('click', () => setMobileMenuOpen(false)))

document.addEventListener('keydown', (event) => {
  const menuOpen = menuBtn?.getAttribute('aria-expanded') === 'true'
  if (event.key === 'Escape' && menuOpen) {
    setMobileMenuOpen(false)
    menuBtn?.focus()
  }
})

window.addEventListener('resize', () => {
  if (window.innerWidth > 1120 && menuBtn?.getAttribute('aria-expanded') === 'true') {
    setMobileMenuOpen(false)
  }
})

const consoleRoot = 'https://statskey-network.fleaflickerflacking.chatgpt.site/'
const consoleUrls = {
  'control-plane': consoleRoot,
  economics: `${consoleRoot}economics`,
}
const consoleFrame = document.getElementById('network-console-frame')
const consoleShell = document.querySelector('.network-console')
const consoleStatus = document.getElementById('network-console-status')
const consoleButtons = Array.from(document.querySelectorAll('[data-console-view]'))
const pageTabs = Array.from(document.querySelectorAll('[data-network-tab]'))
const consoleSection = document.getElementById('working-console')
let activeConsoleView = 'control-plane'

const setPageTab = (view) => {
  pageTabs.forEach((tab) => {
    if (tab.dataset.networkTab === view) tab.setAttribute('aria-current', 'page')
    else tab.removeAttribute('aria-current')
  })
}

const setConsoleView = (view, { scroll = false } = {}) => {
  if (!consoleUrls[view] || !consoleFrame) return
  activeConsoleView = view
  consoleButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.consoleView === view))
  })
  setPageTab(view)

  const nextUrl = consoleUrls[view]
  if (consoleFrame.src !== nextUrl) {
    consoleShell?.classList.remove('is-ready')
    if (consoleStatus) consoleStatus.textContent = `Loading ${view === 'economics' ? 'economics' : 'control plane'}…`
    consoleFrame.title = view === 'economics'
      ? 'Interactive StatsKey Network economics model'
      : 'Interactive StatsKey Network control plane'
    consoleFrame.src = nextUrl
  }

  if (scroll) {
    consoleSection?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
  }
}

consoleFrame?.addEventListener('load', () => {
  consoleShell?.classList.add('is-ready')
  if (consoleStatus) consoleStatus.textContent = activeConsoleView === 'economics' ? 'Economics ready' : 'Control plane ready'
})

consoleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const view = button.dataset.consoleView
    if (!consoleUrls[view]) return
    history.replaceState(null, '', `#${view}`)
    setConsoleView(view)
  })
})

const activateHash = ({ scroll = false } = {}) => {
  const view = window.location.hash.replace('#', '') || 'overview'
  if (view === 'economics' || view === 'control-plane') {
    setConsoleView(view, { scroll })
    return
  }
  setPageTab('overview')
  if (scroll && view === 'overview') {
    document.getElementById('overview')?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' })
  }
}

pageTabs.forEach((tab) => {
  tab.addEventListener('click', (event) => {
    const view = tab.dataset.networkTab
    if (view !== 'control-plane' && view !== 'economics') return
    event.preventDefault()
    history.pushState(null, '', `#${view}`)
    setConsoleView(view, { scroll: true })
  })
})

document.querySelectorAll('a[href="#control-plane"], a[href="#economics"]').forEach((link) => {
  if (link.hasAttribute('data-network-tab')) return
  link.addEventListener('click', (event) => {
    event.preventDefault()
    const view = link.getAttribute('href').slice(1)
    history.pushState(null, '', `#${view}`)
    setConsoleView(view, { scroll: true })
  })
})

window.addEventListener('hashchange', () => activateHash({ scroll: true }))
activateHash({ scroll: Boolean(window.location.hash) })
