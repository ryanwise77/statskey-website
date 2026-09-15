import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { APP_STORE_URL, GOOGLE_PLAY_URL, applyStoreLinks, buildStoreLinks, readStoreCampaign } from '../src/storeLinks.js'

const manifest = JSON.parse(fs.readFileSync(new URL('../docs/mobile-acquisition-links.json', import.meta.url), 'utf8'))
const storage = () => {
  const entries = new Map()
  return { getItem: key => entries.get(key) || null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) }
}
const params = campaign => new URL(campaign.url).search

test('each ad link lands on the mobile section and retains its identity in both stores', () => {
  assert.equal(new Set(manifest.links.map(row => row.campaign)).size, 5)
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8')
  const section = html.match(/<section id="download"[\s\S]*?<\/section>/)?.[0]
  assert.ok(section?.includes('data-store="ios"'))
  assert.ok(section?.includes('data-store="play"'))
  for (const row of manifest.links) {
    const landing = new URL(row.url)
    assert.equal(landing.origin, 'https://statskey.ai')
    assert.equal(landing.pathname, '/')
    assert.equal(landing.hash, '#download')
    const campaign = readStoreCampaign(landing.search)
    const links = buildStoreLinks(campaign)
    const ios = new URL(links.ios)
    assert.equal(ios.hostname, 'apps.apple.com')
    assert.ok(ios.pathname.endsWith('id6751132823'))
    assert.equal(ios.searchParams.get('pt'), '128070906')
    assert.equal(ios.searchParams.get('ct'), row.campaign)
    assert.equal(ios.searchParams.get('mt'), '8')
    const play = new URL(links.play)
    assert.equal(play.hostname, 'play.google.com')
    assert.equal(play.searchParams.get('id'), 'com.statskey.biometrics')
    const referrer = new URLSearchParams(play.searchParams.get('referrer'))
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign']) {
      assert.equal(play.searchParams.get(key), landing.searchParams.get(key))
      assert.equal(referrer.get(key), landing.searchParams.get(key))
    }
  }
})

test('direct visits preserve the ordinary mobile destinations', () => {
  assert.deepEqual(buildStoreLinks(readStoreCampaign('')), { ios: APP_STORE_URL, play: GOOGLE_PLAY_URL })
})

test('the most recent tagged visit survives navigation within the tab', () => {
  const tab = storage()
  readStoreCampaign(params(manifest.links[0]), tab, 1000)
  assert.equal(readStoreCampaign('', tab, 2000).utm_campaign, manifest.links[0].campaign)
  readStoreCampaign(params(manifest.links[1]), tab, 3000)
  assert.equal(readStoreCampaign('', tab, 4000).utm_campaign, manifest.links[1].campaign)
  assert.equal(readStoreCampaign('', storage(), 4000), null)
})

test('cached attribution expires after 24 hours', () => {
  const tab = storage()
  readStoreCampaign(params(manifest.links[0]), tab, 1000)
  assert.equal(readStoreCampaign('', tab, 1000 + 86400000), null)
})

test('partial or malformed campaigns clear stale attribution and cannot change destinations', () => {
  for (const query of ['?utm_source=reddit', '?utm_source=reddit&utm_medium=paid_social&utm_campaign=' + 'a'.repeat(31), '?utm_source=reddit&utm_medium=paid_social&utm_campaign=%3Cscript%3E', '?utm_source=reddit&utm_medium=paid_social&utm_campaign=https://evil.example']) {
    const tab = storage()
    readStoreCampaign(params(manifest.links[0]), tab, 1000)
    assert.equal(readStoreCampaign(query, tab, 2000), null)
    assert.equal(readStoreCampaign('', tab, 3000), null)
    assert.deepEqual(buildStoreLinks(readStoreCampaign(query)), { ios: APP_STORE_URL, play: GOOGLE_PLAY_URL })
  }
})

test('blocked and corrupted browser storage do not break tagged links', () => {
  const blocked = { getItem() { throw Error('blocked') }, setItem() { throw Error('blocked') }, removeItem() { throw Error('blocked') } }
  assert.equal(readStoreCampaign(params(manifest.links[0]), blocked).utm_campaign, manifest.links[0].campaign)
  assert.equal(readStoreCampaign('', blocked), null)
  assert.equal(readStoreCampaign('', { getItem: () => '{broken' }), null)
})

test('ad content survives Play encoding; unrelated query data is excluded', () => {
  const campaign = readStoreCampaign(params(manifest.links[0]) + '&utm_content=video_02&utm_term=meal-photo&email=private@example.com&redirect=https://evil.example')
  const play = new URL(buildStoreLinks(campaign).play)
  const referrer = new URLSearchParams(play.searchParams.get('referrer'))
  assert.equal(referrer.get('utm_content'), 'video_02')
  assert.equal(referrer.get('utm_term'), 'meal-photo')
  assert.equal(referrer.has('email'), false)
  assert.equal(referrer.has('redirect'), false)
})

test('all mobile buttons are wired even if session storage is unavailable', () => {
  const button = () => ({ hidden: true, setAttribute(key, value) { this[key] = value } })
  const ios = [button(), button(), button()]
  const play = [button(), button(), button()]
  const root = {
    defaultView: { location: { search: params(manifest.links[3]) }, get sessionStorage() { throw Error('blocked') } },
    querySelectorAll: selector => selector.includes('ios') ? ios : play,
  }
  applyStoreLinks(root)
  assert.ok(ios.every(el => new URL(el.href).searchParams.get('ct') === manifest.links[3].campaign))
  assert.ok(play.every(el => !el.hidden && new URL(el.href).searchParams.get('utm_campaign') === manifest.links[3].campaign))
})
