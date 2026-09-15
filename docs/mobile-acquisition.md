# StatsKey mobile advertising links

Use these as the destination URLs in ads. All open the website's **mobile app download section**, containing the App Store and Google Play buttons. The section also offers a desktop preview, but these campaigns tag only the mobile store buttons. YouTube ads use the YouTube link even when purchased through Google Ads; Google Search uses its own link. Meta combines Facebook and Instagram.

| Advertising platform | Destination | Campaign in download reports |
| --- | --- | --- |
| YouTube | https://statskey.ai/?utm_source=youtube&utm_medium=paid_video&utm_campaign=youtube_ads#download | `youtube_ads` |
| Reddit | https://statskey.ai/?utm_source=reddit&utm_medium=paid_social&utm_campaign=reddit_ads#download | `reddit_ads` |
| TikTok | https://statskey.ai/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=tiktok_ads#download | `tiktok_ads` |
| Meta (Facebook + Instagram) | https://statskey.ai/?utm_source=meta&utm_medium=paid_social&utm_campaign=meta_ads#download | `meta_ads` |
| Google Search | https://statskey.ai/?utm_source=google&utm_medium=cpc&utm_campaign=google_ads#download | `google_ads` |

## Where to see downloads

**iPhone/iPad:** Open [App Store Connect](https://appstoreconnect.apple.com/) → StatsKey → Analytics → Acquisition → Campaigns. Compare **First-Time Downloads** for the five campaign names above over the same date range. Apple attributes a qualifying first-time download within 24 hours of clicking the tagged store link. Campaign reporting needs at least five first-time users and at least 24 hours; individual metrics have minimum thresholds. Missing rows are unknown, not zero. [Apple's campaign reporting documentation](https://developer.apple.com/help/app-store-connect-analytics/acquisition/campaign-links).

**Android:** In [Google Play Console](https://play.google.com/console/), use StatsKey's downloadable **store performance → traffic source** report, group by **UTM source / UTM campaign**, and compare **Store listing acquisitions**. The exported columns include those dimensions and acquisition counts. [Google's downloadable report documentation](https://support.google.com/googleplay/android-developer/answer/6135870?hl=en).

Google's on-screen Store performance → Conversion analysis now emphasizes **install clicks**, which do not prove completed downloads. Acquisitions remain available through Statistics and downloadable reports. Low-volume UTM data may be grouped as Other. [Google's current measurement definitions](https://support.google.com/googleplay/android-developer/answer/9859173?hl=en).

## What is wired

- Every opted-in mobile store button carries the current campaign: Apple `pt` / `ct` / `mt`; Play top-level UTMs plus encoded Install Referrer.
- The provider token `128070906` is the existing public token recorded from StatsKey's generated App Store Connect campaign link in the September 10 Instagram acquisition setup.
- The most recent tagged visit is kept within the same browser tab for up to 24 hours so browsing between pages using the shared store-link code retains the source. Browser storage restrictions do not stop tagging from the current URL.
- Direct visits without a saved campaign keep ordinary store links. Invalid/partial campaign parameters clear cached attribution. Campaign tokens must be at most 30 letters, numbers, underscores, hyphens or periods; tokens are not silently truncated.
- These are store-level acquisition campaigns. They do not add individual social attribution to StatsKey's signup/subscriber report, create a new analytics dashboard, change ad spend, or place links into ad accounts.
- The site uses JavaScript to attach campaign parameters. Actual eligible acquisitions are needed before either store can show these new campaigns; destination checks cannot prove a completed download or store reporting.
- If entering parameters in an ad platform's final URL suffix field, put `utm_source=...&utm_medium=...&utm_campaign=...` there without `?` or `#download`, and use `https://statskey.ai/#download` as the final URL. Keep Google's auto-tagging enabled if it is already enabled.

Machine-readable versions: `mobile-acquisition-links.json`.
