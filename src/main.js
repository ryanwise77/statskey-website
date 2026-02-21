import './style.css'

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
menuBtn?.addEventListener('click', () => mobileMenu.classList.toggle('hidden'))
mobileMenu?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => mobileMenu.classList.add('hidden'))
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
