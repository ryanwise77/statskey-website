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

// Wire any opted-in store buttons. iOS buttons keep their hard-coded href as a
// no-JS fallback and are only re-asserted when a node opts in with
// data-store="ios"; Play buttons reveal + gain their href once a URL exists.
export function applyStoreLinks(root = document) {
  root.querySelectorAll('[data-store="ios"]').forEach((el) => {
    if (APP_STORE_URL) el.setAttribute('href', APP_STORE_URL)
  })

  const hasPlay = Boolean(GOOGLE_PLAY_URL)
  root.querySelectorAll('[data-store="play"]').forEach((el) => {
    if (hasPlay) {
      el.setAttribute('href', GOOGLE_PLAY_URL)
      el.hidden = false
    } else {
      el.hidden = true
    }
  })
}
