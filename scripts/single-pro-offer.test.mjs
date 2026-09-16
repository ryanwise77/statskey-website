import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'
const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8')
const publicPaths = ['index.html', 'support.html', 'public/mindscape/index.html', 'public/esther-briefing/index.html', 'nike-statskey-presentation.html', 'public/nike-run-club/index.html']
for (const path of publicPaths) {
  test(`${path} advertises distinct Pro and Pro+ without stale prices`, () => {
    const source = read(path)
    assert.match(source, /\$69\.99/)
    assert.match(source, /\$699/)
    assert.match(source, /Pro\+/)
    assert.match(source, /\$99\.99/)
    assert.match(source, /\$999/)
    assert.doesNotMatch(source, /\$14\.99|\$29\.99|\$149\.99|\$199\.99|one optional Pro|single paid subscription|One Pro subscription/)
    assert.doesNotMatch(source, /From September 14, 2026, for new U\.S\. iOS customers/)
    assert.doesNotMatch(source, /[Oo]ne month free|[Gg]et 1 month|50%\+.*gross margin/)
  })
}
test('all translated support offers retain distinct tiers and independently metered uses', () => {
  let catalog
  vm.runInNewContext(read('src/i18n/support.js').replace(/^import .*\n/, ''), { applyI18n: (value) => { catalog = value } })
  for (const language of ['de', 'ja', 'pt', 'es']) {
    const source = catalog[language]['lp-content']
    assert.match(source, /Pro\+/)
    assert.match(source, /69[.,]99/)
    assert.match(source, /699/)
    assert.match(source, /99[.,]99/)
    assert.match(source, /999/)
    assert.match(source, /Data Agent/)
    assert.match(source, /Auto/)
  }
})
test('actual app keeps tier boundaries while token-pack catalog remains independent', () => {
  assert.match(read('src/app/routes/Profile.tsx'), /PRO_SUBSCRIPTION_OPTIONS\.map/)
  assert.match(read('src/app/lib/subscriptionOffer.ts'), /proPlusMonthly/)
  assert.match(read('src/app/lib/subscriptionOffer.ts'), /proPlusAnnual/)
  assert.match(read('src/app/components/NutritionFacts.tsx'), /useProPlusAccess\(subscription\)/)
  assert.match(read('src/app/components/NutritionFacts.tsx'), /displayMeal\.totalNutrientsOverride == null/)
  assert.match(read('src/app/routes/Profile.tsx'), /subscriptionPlanLabel\(subState\.subscription\)/)
  const tokens = read('src/app/routes/Tokens.tsx')
  assert.match(tokens, /Pro\+ unlimited applies only to eligible Auto-routed conversations under fair use/)
  assert.match(tokens, /even on Pro\+\./)
})
