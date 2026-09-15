// Single source of truth for the app-store links used across the site.
//
// TO LAUNCH ON ANDROID: paste the live Google Play listing URL into
// GOOGLE_PLAY_URL below. Every element marked `data-store="play"` (which ships
// hidden) then reveals itself and points at that URL. While the string is
// empty, all Play buttons stay hidden — so the site never shows a dead Play
// link before the listing is live.
//
// The Play URL is deterministic from your applicationId:
//   https://play.google.com/store/apps/details?id=<your.package.id>
export const APP_STORE_URL = 'https://apps.apple.com/us/app/statskey/id6751132823'

export const GOOGLE_PLAY_URL = 'https://play.google.com/store/apps/details?id=com.statskey.biometrics'

// Public provider token from StatsKey's App Store Connect campaign link.
const APPLE_PROVIDER_TOKEN = '128070906'
const CAMPAIGN_STORAGE_KEY = 'statskey:mobile-campaign:v1'
const CAMPAIGN_TTL_MS = 24 * 60 * 60 * 1000
const CAMPAIGN_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

function validCampaign(value) {
  if (!value || typeof value !== 'object') return null
  const clean = {}
  for (const key of CAMPAIGN_KEYS) {
    const field = value[key]
    const required = ['utm_source', 'utm_medium', 'utm_campaign'].includes(key)
    if (!required && (field === undefined || field === '')) continue
    // Reject unsupported/overlong tokens instead of silently merging campaigns.
    const maxLength = key === 'utm_campaign' ? 30 : 100
    if (typeof field !== 'string' || !field || field.length > maxLength || !/^[a-zA-Z0-9_.-]+$/.test(field)) return null
    clean[key] = field
  }
  return clean
}

export function readStoreCampaign(search, storage, now = Date.now()) {
  const params = new URLSearchParams(search)
  if (CAMPAIGN_KEYS.some((key) => params.has(key))) {
    const campaign = validCampaign(Object.fromEntries(params))
    try {
      if (campaign) storage?.setItem(CAMPAIGN_STORAGE_KEY, JSON.stringify({ campaign, at: now }))
      else storage?.removeItem(CAMPAIGN_STORAGE_KEY)
    } catch { /* Store links must still work when browser storage is blocked. */ }
    return campaign
  }

  try {
    const saved = JSON.parse(storage?.getItem(CAMPAIGN_STORAGE_KEY) || 'null')
    if (saved && Number.isFinite(saved.at) && now >= saved.at && now - saved.at < CAMPAIGN_TTL_MS) {
      return validCampaign(saved.campaign)
    }
    storage?.removeItem(CAMPAIGN_STORAGE_KEY)
  } catch { /* Malformed or unavailable storage falls back to ordinary links. */ }
  return null
}

export function buildStoreLinks(campaign) {
  const clean = validCampaign(campaign)
  if (!clean) return { ios: APP_STORE_URL, play: GOOGLE_PLAY_URL }

  const ios = new URL(`https://apps.apple.com/app/apple-store/id6751132823`)
  ios.searchParams.set('pt', APPLE_PROVIDER_TOKEN)
  ios.searchParams.set('ct', clean.utm_campaign)
  ios.searchParams.set('mt', '8')

  const play = GOOGLE_PLAY_URL ? new URL(GOOGLE_PLAY_URL) : null
  if (play) {
    // Top-level UTMs support Play Console reporting; referrer carries the same
    // campaign through installation for clients using Play Install Referrer.
    const referrer = new URLSearchParams(clean)
    for (const [key, value] of referrer) play.searchParams.set(key, value)
    play.searchParams.set('referrer', referrer.toString())
  }
  return { ios: ios.toString(), play: play?.toString() || '' }
}

// Wire any opted-in store buttons. iOS buttons keep their hard-coded href as a
// no-JS fallback and are only re-asserted when a node opts in with
// data-store="ios"; Play buttons reveal + gain their href once a URL exists.
export function applyStoreLinks(root = document) {
  const view = root.defaultView || root.ownerDocument?.defaultView
  let storage
  try { storage = view?.sessionStorage } catch { /* Safari private/storage restrictions. */ }
  const campaign = readStoreCampaign(view?.location.search || '', storage)
  const links = buildStoreLinks(campaign)
  root.querySelectorAll('[data-store="ios"]').forEach((el) => {
    if (links.ios) el.setAttribute('href', links.ios)
  })

  const hasPlay = Boolean(GOOGLE_PLAY_URL)
  root.querySelectorAll('[data-store="play"]').forEach((el) => {
    if (hasPlay) {
      el.setAttribute('href', links.play)
      el.hidden = false
    } else {
      el.hidden = true
    }
  })
}
