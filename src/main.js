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
  { threshold: 0.08, rootMargin: '0px 0px -20px 0px' }
)

document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el))

const nav = document.getElementById('nav')
window.addEventListener('scroll', () => {
  if (window.scrollY > 20) {
    nav.classList.add('border-border')
    nav.classList.remove('border-transparent')
  } else {
    nav.classList.remove('border-border')
    nav.classList.add('border-transparent')
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
