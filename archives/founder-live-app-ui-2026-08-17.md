# Founder live app-style UI archive

Archived: August 17, 2026

This record preserves the app-influenced public website UI that preceded the
web-native founder data archive.

- Immutable deployment:
  `https://statskey-website-24ouc50d5-stats-key.vercel.app/#founder-live`
- Vercel deployment ID: `dpl_4Chg4TEhtp27zeHEQK13mE84Djkn`
- Local source snapshot: the legacy renderers remain in
  `src/founderLive.js` as uncalled functions, including `mealsHome`,
  `mealDetail`, `dayNutritionDetail`, `mealSourceDetail`,
  `recordWeekStrip`, `dailyRecordSummary`, `recordWaterCard`, and
  `mealTimeline`.
- Legacy visual rules remain identifiable by the `.ios-record-*`,
  `.ios-daily-*`, `.ios-fda-*`, and `.ios-provenance-*` selectors in
  `src/style.css`.

Production no longer calls those renderers. The replacement intentionally uses
a distinct web-data presentation so the public record communicates the data
without reproducing StatsKey's app interface.
