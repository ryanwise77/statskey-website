// Lightweight client-side i18n for the static legal / support pages.
//
// A page calls `applyI18n({ de: {...}, ja: {...} })`. Each language object maps
// element ids -> translated innerHTML, plus optional special keys:
//   __title : document <title> for that language
//   __note  : disclaimer HTML shown in #lp-xlnote (e.g. "English is authoritative")
//
// Language resolution order: ?lang= query  ->  saved choice  ->  device language
// ->  English. The choice persists in localStorage and is reflected in the URL so
// App Store Connect can link a deterministic per-locale URL (e.g. /privacy?lang=ja).
const SUPPORTED = ['en', 'es', 'de', 'ja', 'pt']
const STORE_KEY = 'sk_lang'

function detectLang() {
  try {
    const q = (new URLSearchParams(location.search).get('lang') || '').toLowerCase().slice(0, 2)
    if (SUPPORTED.includes(q)) return q
  } catch (_) {}
  try {
    const saved = localStorage.getItem(STORE_KEY)
    if (saved && SUPPORTED.includes(saved)) return saved
  } catch (_) {}
  const nav = (navigator.language || 'en').toLowerCase().slice(0, 2)
  return SUPPORTED.includes(nav) ? nav : 'en'
}

export function applyI18n(translations) {
  // Collect every element id referenced by any language.
  const ids = new Set()
  for (const lang of Object.keys(translations)) {
    const dict = translations[lang]
    if (dict) for (const k of Object.keys(dict)) if (!k.startsWith('__')) ids.add(k)
  }

  // Cache the authoritative English markup so switching back is lossless.
  const originals = {}
  ids.forEach((id) => {
    const el = document.getElementById(id)
    if (el) originals[id] = el.innerHTML
  })
  const originalTitle = document.title

  function render(lang) {
    const dict = lang === 'en' ? null : translations[lang]
    ids.forEach((id) => {
      const el = document.getElementById(id)
      if (!el) return
      el.innerHTML = dict && dict[id] != null ? dict[id] : originals[id]
    })

    document.title = dict && dict.__title ? dict.__title : originalTitle

    const note = document.getElementById('lp-xlnote')
    if (note) {
      const html = dict && dict.__note ? dict.__note : ''
      note.innerHTML = html
      note.hidden = !html
    }

    document.documentElement.lang = lang
    document.querySelectorAll('#lang-switch [data-lang]').forEach((btn) => {
      if (btn.getAttribute('data-lang') === lang) btn.setAttribute('aria-current', 'true')
      else btn.removeAttribute('aria-current')
    })
  }

  function setLang(lang) {
    if (!SUPPORTED.includes(lang)) lang = 'en'
    try { localStorage.setItem(STORE_KEY, lang) } catch (_) {}
    try {
      const url = new URL(location.href)
      if (lang === 'en') url.searchParams.delete('lang')
      else url.searchParams.set('lang', lang)
      history.replaceState(null, '', url)
    } catch (_) {}
    render(lang)
  }

  document.querySelectorAll('#lang-switch [data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang')))
  })

  render(detectLang())
}
