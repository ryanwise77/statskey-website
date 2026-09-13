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
const languageTag = (lang) => lang === 'pt' ? 'pt-BR' : lang
const primaryLanguage = (value) => typeof value === 'string'
  ? value.trim().replaceAll('_', '-').toLowerCase().split('-')[0]
  : null
const LABELS = {
  en: { features: 'Features', intelligence: 'Intelligence', iosApp: 'iOS app', getApp: 'Get the app', app: 'App', signIn: 'Sign in', signUp: 'Sign up', support: 'Support', privacy: 'Privacy', terms: 'Terms', home: 'StatsKey home', language: 'Language' },
  es: { features: 'Funciones', intelligence: 'Intelligence', iosApp: 'App para iOS', getApp: 'Obtener la app', app: 'App', signIn: 'Iniciar sesión', signUp: 'Crear cuenta', support: 'Soporte', privacy: 'Privacidad', terms: 'Términos', home: 'Inicio de StatsKey', language: 'Idioma' },
  de: { features: 'Funktionen', intelligence: 'Intelligence', iosApp: 'iOS-App', getApp: 'App herunterladen', app: 'App', signIn: 'Anmelden', signUp: 'Registrieren', support: 'Support', privacy: 'Datenschutz', terms: 'Nutzungsbedingungen', home: 'StatsKey-Startseite', language: 'Sprache' },
  ja: { features: '機能', intelligence: 'Intelligence', iosApp: 'iOSアプリ', getApp: 'アプリを入手', app: 'アプリ', signIn: 'サインイン', signUp: 'アカウント作成', support: 'サポート', privacy: 'プライバシー', terms: '利用規約', home: 'StatsKeyのホーム', language: '言語' },
  pt: { features: 'Recursos', intelligence: 'Intelligence', iosApp: 'App para iOS', getApp: 'Baixar o app', app: 'App', signIn: 'Entrar', signUp: 'Criar conta', support: 'Suporte', privacy: 'Privacidade', terms: 'Termos', home: 'Página inicial do StatsKey', language: 'Idioma' },
}

export function resolveLegalLanguage(preferences, available = SUPPORTED) {
  for (const preference of preferences) {
    if (typeof preference !== 'string') continue
    const lang = primaryLanguage(preference)
    if (available.includes(lang)) return lang
  }
  return 'en'
}

function detectLang(available) {
  const preferences = []
  try {
    preferences.push(new URLSearchParams(location.search).get('lang'))
  } catch (_) {}
  try {
    preferences.push(localStorage.getItem(STORE_KEY))
  } catch (_) {}
  preferences.push(...(navigator.languages || []), navigator.language)
  return resolveLegalLanguage(preferences, available)
}

export function applyI18n(translations) {
  const available = SUPPORTED.filter((lang) => lang === 'en' || translations[lang])
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
      const translated = dict && dict[id] != null
      el.innerHTML = translated ? dict[id] : originals[id]
      el.lang = translated ? languageTag(lang) : 'en'
    })

    document.title = dict && dict.__title ? dict.__title : originalTitle

    const note = document.getElementById('lp-xlnote')
    if (note) {
      const html = dict && dict.__note ? dict.__note : ''
      note.innerHTML = html
      note.hidden = !html
    }

    document.documentElement.lang = languageTag(lang)
    document.querySelectorAll('[data-legal-label]').forEach((el) => {
      const label = LABELS[lang][el.getAttribute('data-legal-label')]
      if (label) el.textContent = label
    })
    document.querySelectorAll('[data-legal-aria]').forEach((el) => {
      const label = LABELS[lang][el.getAttribute('data-legal-aria')]
      if (label) el.setAttribute('aria-label', label)
    })
    document.querySelectorAll('#lang-switch [data-lang]').forEach((btn) => {
      if (btn.getAttribute('data-lang') === lang) btn.setAttribute('aria-current', 'true')
      else btn.removeAttribute('aria-current')
    })

    // Preserve the reader's choice across legal/support pages even when the
    // browser blocks localStorage. Leave app, external, and download URLs alone.
    document.querySelectorAll('a[href]').forEach((link) => {
      try {
        const url = new URL(link.getAttribute('href'), location.href)
        if (url.origin !== location.origin || !/^\/(privacy|terms|support)(?:\.html)?\/?$/.test(url.pathname)) return
        url.searchParams.set('lang', lang)
        link.setAttribute('href', `${url.pathname}${url.search}${url.hash}`)
      } catch (_) {}
    })
  }

  function setLang(lang) {
    lang = resolveLegalLanguage([lang], available)
    try { localStorage.setItem(STORE_KEY, lang) } catch (_) {}
    try {
      const url = new URL(location.href)
      url.searchParams.set('lang', lang)
      history.replaceState(null, '', url)
    } catch (_) {}
    render(lang)
  }

  document.querySelectorAll('#lang-switch [data-lang]').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.getAttribute('data-lang')))
  })

  const initialLang = detectLang(available)
  // App Store links include a locale query. Remember that explicit choice so
  // it continues to work after the reader follows a link without a query.
  const query = new URLSearchParams(location.search).get('lang')
  if (available.includes(primaryLanguage(query))) {
    try { localStorage.setItem(STORE_KEY, initialLang) } catch (_) {}
  }
  render(initialLang)
}
