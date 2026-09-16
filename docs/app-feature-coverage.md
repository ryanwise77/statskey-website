# Public app preview coverage — September 15, 2026

The homepage presents Strength as an illustrative plan/train/review tour, with a
mobile download action and a secondary link to the existing web Strength route.
It no longer imports workout image/video exporters or offers editing/download
controls inside the public sample. The authenticated Strength implementation is
unchanged. All preview panels remain readable without JavaScript; enhancement
adds keyboard-operated tabs. The displayed rest timer is explicitly an example.

The app overview was cross-checked against the current StatsKey native source.
Implementation evidence does not establish identical availability in every store
version or platform. These differences are visible in the overview; existing
Pro/Pro+ prices and boundaries are retained.

| Public feature area | Native source basis (within the StatsKey app repository) |
|---|---|
| Nutrition capture, edits, library, evidence | `Views/Record/RecordView.swift`, nutrition pipeline contract and root `AGENTS.md` |
| Strength routines, sessions, summaries, video | `Views/Activity/Lifting/LiftingHomeView.swift`, `LiftingRoutineEditorView.swift`, `LiftingSessionView.swift`, `LiftingSessionSummaryView.swift`, `WorkoutVideoStudioView.swift` |
| Running and other activities | `Views/Activity/ActivityView.swift`, `docs/features/timed-run-entry.md` |
| Fitness and meal planning | `docs/features/fitness-planner-scheduling.md`, `Views/Flow/MealCalendarView.swift` |
| Intelligence and paid access | `Services/ChatToolRouter.swift`, `Views/Flow/ChatView.swift`, `Views/Settings/ProGateView.swift`, `functions/watchIntelligence.js` |
| Health measurements and connections | `Views/Health/HealthBodyView.swift`, `docs/apple-health-data-coverage.md`, `docs/wearable-platform-support.md` |
| Wellness, sensitive-record controls | Wellness/bowel recording and record-lock implementation; configured authentication is optional |
| Friends and sharing | `Views/Friends/FriendsView.swift`, workout sharing and route privacy controls |
| Reports and care access | `Views/Insights/ExportStudio/ExportStudioView.swift`, `Views/Health/ClinicalSharingView.swift` |
| Pet care | `Views/PetCare/PetCareHomeView.swift` |

Native view paths above are relative to `biometrics/StatsKey/`, and backend paths
are relative to `biometrics/`. No new private app assets or personal records were
published. The three app images already existed in the site's public assets.

Claims deliberately excluded: universal wearable/native-app compatibility,
unreleased Garmin/Wear OS availability, universal care portal access, clinical
Health Records import, complete nutrients for every food, photo measurement
precision, automatic rep detection, measured one-rep max, diagnosis or causal
proof. Existing unsubstantiated competitor comparisons were replaced by a
capture/review/connect explanation of the actual product.

Homepage and linked Wellness signup buttons now lead to the configured mobile
download page; `/app/signup` is not implemented in this site's route table.
Store-choice attribution, authenticated routes, founder records and research
concepts retain their existing implementations.
