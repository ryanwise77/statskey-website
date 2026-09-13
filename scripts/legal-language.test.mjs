import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
import { resolveLegalLanguage } from '../src/i18n/legal.js'

const languages = ['en', 'es', 'de', 'ja', 'pt']
const source = readFileSync(new URL('../src/i18n/legal.js', import.meta.url), 'utf8')

function page({ query = '', saved = null, device = ['en-US'], blockedStorage = false, translations } = {}) {
  const elements = new Map()
  function element(id, innerHTML = '', attributes = {}) {
    const listeners = {}
    const el = {
      innerHTML, attributes, listeners,
      setAttribute: (name, value) => { attributes[name] = value },
      getAttribute: (name) => attributes[name] ?? null,
      removeAttribute: (name) => { delete attributes[name] },
      addEventListener: (event, action) => { listeners[event] = action },
    }
    elements.set(id, el)
    return el
  }
  element('lp-title', 'English title')
  element('lp-content', '<p>English content</p>')
  element('lp-xlnote')
  const buttons = languages.map((lang) => element(`button-${lang}`, '', { 'data-lang': lang }))
  const links = ['/terms?from=privacy#billing', '/support.html', '/privacy/', '/app/', 'https://other.example/terms', '/downloads/report.pdf']
    .map((href, i) => element(`link-${i}`, '', { href }))
  const labels = [element('nav-sign-in', '', { 'data-legal-label': 'signIn' }), element('footer-privacy', '', { 'data-legal-label': 'privacy' })]
  const ariaLabels = [element('brand', '', { 'data-legal-aria': 'home' })]
  const document = {
    title: 'English page', documentElement: {},
    getElementById: (id) => elements.get(id),
    querySelectorAll: (selector) => ({ 'a[href]': links, '[data-legal-label]': labels, '[data-legal-aria]': ariaLabels, '#lang-switch [data-lang]': buttons })[selector] ?? [],
  }
  const location = new URL(`https://statskey.ai/privacy${query}`)
  const stored = new Map(saved ? [['sk_lang', saved]] : [])
  const localStorage = {
    getItem(key) { if (blockedStorage) throw new Error('Storage disabled'); return stored.get(key) ?? null },
    setItem(key, value) { if (blockedStorage) throw new Error('Storage disabled'); stored.set(key, value) },
  }
  const history = { replaceState: (_state, _unused, url) => { location.href = url.href } }
  const context = vm.createContext({
    document, location, history, localStorage,
    navigator: { languages: device, language: device[0] }, URL, URLSearchParams,
  })
  vm.runInContext(source.replaceAll('export function ', 'function '), context)
  context.applyI18n(translations ?? Object.fromEntries(languages.filter((lang) => lang !== 'en').map((lang) => [lang, {
    __title: `${lang} page`, 'lp-title': `${lang} title`, 'lp-content': `<p>${lang} content</p>`,
  }])))
  return { elements, document, location, stored, buttons, links }
}

test('resolves regional language aliases and ordered preferences without accepting invalid prefixes', () => {
  assert.equal(resolveLegalLanguage([' ES_mx ', 'de']), 'es')
  assert.equal(resolveLegalLanguage(['pt-BR']), 'pt')
  assert.equal(resolveLegalLanguage(['invalid', 'DE-at']), 'de')
  assert.equal(resolveLegalLanguage(['english', 'fr', 'ja-JP']), 'ja')
  assert.equal(resolveLegalLanguage([null, undefined, 'fr']), 'en')
  assert.equal(resolveLegalLanguage(['de', 'es'], ['en', 'es']), 'es')
})

test('query-selected languages persist and every supported language can be selected and restored', () => {
  for (const lang of languages) {
    const p = page({ query: `?lang=${lang === 'pt' ? 'pt-BR' : lang}`, saved: 'ja', device: ['de-DE'] })
    assert.equal(p.stored.get('sk_lang'), lang)
    assert.equal(p.document.documentElement.lang, lang === 'pt' ? 'pt-BR' : lang)
    assert.equal(p.document.title, lang === 'en' ? 'English page' : `${lang} page`)
    assert.equal(p.elements.get('lp-content').innerHTML, lang === 'en' ? '<p>English content</p>' : `<p>${lang} content</p>`)
    assert.equal(p.buttons.find((button) => button.attributes['data-lang'] === lang).attributes['aria-current'], 'true')
    p.buttons[0].listeners.click()
    assert.equal(p.elements.get('lp-content').innerHTML, '<p>English content</p>')
    assert.equal(p.document.title, 'English page')
    assert.equal(p.location.searchParams.get('lang'), 'en')
  }
})

test('uses all browser language preferences and normalizes saved regional choices', () => {
  assert.equal(page({ device: ['fr-FR', 'ja-JP', 'es'] }).document.documentElement.lang, 'ja')
  assert.equal(page({ saved: 'pt-BR', device: ['de'] }).document.documentElement.lang, 'pt-BR')
  const invalidQuery = page({ query: '?lang=not-a-language', device: ['fr'] })
  assert.equal(invalidQuery.document.documentElement.lang, 'en')
  assert.equal(invalidQuery.stored.size, 0)
})

test('translates navigation, footer links, and accessible labels and restores English on demand', () => {
  const expected = { en: ['Sign in', 'Privacy'], es: ['Iniciar sesión', 'Privacidad'], de: ['Anmelden', 'Datenschutz'], ja: ['サインイン', 'プライバシー'], pt: ['Entrar', 'Privacidade'] }
  for (const [lang, labels] of Object.entries(expected)) {
    const p = page({ query: `?lang=${lang}` })
    assert.equal(p.elements.get('nav-sign-in').textContent, labels[0])
    assert.equal(p.elements.get('footer-privacy').textContent, labels[1])
    assert.ok(p.elements.get('brand').attributes['aria-label'])
    p.buttons[0].listeners.click()
    assert.equal(p.elements.get('nav-sign-in').textContent, 'Sign in')
    assert.equal(p.elements.get('brand').attributes['aria-label'], 'StatsKey home')
  }
})

test('retains language on internal legal links even when storage is blocked, preserving queries and anchors', () => {
  const p = page({ query: '?lang=es-MX', blockedStorage: true })
  assert.equal(p.document.documentElement.lang, 'es')
  assert.equal(p.links[0].attributes.href, '/terms?from=privacy&lang=es#billing')
  assert.equal(p.links[1].attributes.href, '/support.html?lang=es')
  assert.equal(p.links[2].attributes.href, '/privacy/?lang=es')
  assert.equal(p.links[3].attributes.href, '/app/')
  assert.equal(p.links[4].attributes.href, 'https://other.example/terms')
  assert.equal(p.links[5].attributes.href, '/downloads/report.pdf')
  p.buttons[0].listeners.click()
  assert.equal(p.links[0].attributes.href, '/terms?from=privacy&lang=en#billing')
})

test('missing dictionaries select an available language and partial fallbacks identify English content', () => {
  const p = page({ query: '?lang=de', saved: 'es', translations: { es: { 'lp-title': 'Español' } } })
  assert.equal(p.document.documentElement.lang, 'es')
  assert.equal(p.elements.get('lp-title').innerHTML, 'Español')
  // IDs absent from every dictionary stay in their original English markup.
  assert.equal(p.elements.get('lp-content').innerHTML, '<p>English content</p>')
  const fallback = page({ query: '?lang=es', translations: { es: { 'lp-title': 'Español' }, de: { 'lp-content': 'Deutsch' } } })
  assert.equal(fallback.elements.get('lp-content').innerHTML, '<p>English content</p>')
  assert.equal(fallback.elements.get('lp-content').lang, 'en')
})

for (const name of ['privacy', 'terms', 'support']) {
  test(`${name} has complete nonempty content for every language offered by its selector`, () => {
    const html = readFileSync(new URL(`../${name}.html`, import.meta.url), 'utf8')
    const catalog = readFileSync(new URL(`../src/i18n/${name}.js`, import.meta.url), 'utf8')
    let translations
    vm.runInNewContext(catalog.replace(/^import .*\n/, ''), { applyI18n: (value) => { translations = value } })
    const offered = [...html.matchAll(/data-lang="([^"]+)"/g)].map((match) => match[1])
    assert.deepEqual(offered, languages)
    const required = new Set(Object.values(translations).flatMap((dict) => Object.keys(dict)))
    for (const lang of offered.filter((value) => value !== 'en')) {
      assert.ok(translations[lang], `Missing ${lang} dictionary`)
      for (const key of required) {
        assert.equal(typeof translations[lang][key], 'string', `${lang}: missing ${key}`)
        assert.ok(translations[lang][key].trim(), `${lang}: empty ${key}`)
        if (!key.startsWith('__')) assert.ok(html.includes(`id="${key}"`), `Missing page element ${key}`)
      }
      assert.ok(translations[lang]['lp-content'].length > 1000, `${lang}: missing full-page translation`)
      assert.ok(!translations[lang]['lp-content'].includes('undefined'))
    }
  })
}
