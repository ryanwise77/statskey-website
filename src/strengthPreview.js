// A presentation-only tour: no workout, account, storage, or upload access.
// Without JavaScript all three examples remain readable in document order.
export function initStrengthPreview() {
  const root = document.querySelector('[data-strength-preview]')
  if (!root) return
  const tablist = root.querySelector('[data-strength-tabs]')
  const tabs = Array.from(root.querySelectorAll('[data-strength-tab]'))
  const panels = Array.from(root.querySelectorAll('[data-strength-panel]'))
  if (!tablist || !tabs.length || tabs.length !== panels.length) return

  function select(index, focus = false) {
    tabs.forEach((tab, current) => {
      const active = current === index
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      panels[current].hidden = !active
    })
    if (focus) tabs[index].focus()
  }

  tablist.setAttribute('role', 'tablist')
  tabs.forEach((tab, index) => {
    tab.setAttribute('role', 'tab')
    panels[index].setAttribute('role', 'tabpanel')
    panels[index].setAttribute('aria-labelledby', tab.id)
    panels[index].tabIndex = 0
    tab.addEventListener('click', () => select(index))
    tab.addEventListener('keydown', (event) => {
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index - 1 + tabs.length) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key]
      if (next === undefined) return
      event.preventDefault()
      select(next, true)
    })
  })
  select(0)
  tablist.hidden = false
}
