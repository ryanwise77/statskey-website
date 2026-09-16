import fs from "node:fs";
import { pathToFileURL } from "node:url";

const title = "Nutrition, training, and progress. Together. | StatsKey";
const description = "Log meals, build workouts, and see your progress with StatsKey. Download the app for iPhone or Android and bring your nutrition and training together.";

export function buildDownloadPage(homepage) {
  const hero = homepage.match(/<section class="hero-section"[\s\S]*?<\/section>/)?.[0];
  if (!hero) throw new Error("The homepage hero is missing; cannot generate the campaign page.");
  const stores = ["ios", "play"].map((store) => {
    const button = hero.match(new RegExp(`<a\\b[^>]*data-store="${store}"[^>]*>[\\s\\S]*?<\\/a>`))?.[0];
    if (!button) throw new Error(`The ${store} download button is missing from the homepage.`);
    return button;
  }).join("\n");
  const campaignHero = `<section class="campaign-product-hero" id="welcome" data-analytics-section="welcome" aria-labelledby="campaign-title">
        <div class="page-shell campaign-product-grid">
          <div class="campaign-product-copy">
            <p class="campaign-eyebrow">NUTRITION. TRAINING. YOUR EVERYDAY.</p>
            <h1 id="campaign-title">Eat better.<br>Exercise with<br><span>purpose.</span></h1>
            <p class="campaign-product-lede">Log a meal, build a workout, and see how your habits add up. StatsKey brings your nutrition and training into one place.</p>
            <div class="campaign-store-choices" aria-label="Download the mobile app">${stores}</div>
            <p class="campaign-availability">Free to download on iPhone and Android.<br>Optional Pro and Pro+ plans. <a href="/app/tokens">Compare plans</a></p>
            <a class="campaign-explore" href="#strength">See what’s inside <span aria-hidden="true">↓</span></a>
          </div>
          <figure class="campaign-product-visual">
            <img class="campaign-map-screen" src="/statskey-app/appstore-run-map.jpg" width="1290" height="2796" alt="StatsKey run detail showing a recorded route on a map, distance, pace, heart rate, and elevation" fetchpriority="high" decoding="async">
            <figcaption>A run, mapped and recorded. iPhone app.</figcaption>
          </figure>
        </div>
        <div class="page-shell campaign-benefits" aria-label="Explore the app">
          <a href="#positioning"><span class="campaign-benefit-number">01</span><span><strong>Make food make sense.</strong><small>Meals, nutrients, and the details behind them.</small></span><span aria-hidden="true">↗</span></a>
          <a href="#strength"><span class="campaign-benefit-number">02</span><span><strong>Find your training rhythm.</strong><small>Routines, recorded sets, and progress over time.</small></span><span aria-hidden="true">↗</span></a>
          <a href="#gut"><span class="campaign-benefit-number">03</span><span><strong>Keep the whole day in view.</strong><small>Your wellness alongside nutrition and movement.</small></span><span aria-hidden="true">↗</span></a>
        </div>
      </section>`;

  return homepage
    .replace('<body class="antialiased marketing-light">', '<body class="antialiased marketing-light campaign-landing">')
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(/(<meta name="description" content=")[^"]*/, `$1${description}`)
    .replace(/(<meta (?:property="og:description"|name="twitter:description") content=")[^"]*/g, `$1${description}`)
    .replace(/(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*/g, `$1${title}`)
    .replace('href="https://statskey.ai/"', 'href="https://statskey.ai/download"')
    .replace('content="https://statskey.ai/"', 'content="https://statskey.ai/download"')
    .replace(hero, campaignHero)
    .replaceAll('href="/download"', 'href="#download"')
    .replace(/\s*<a class="button button--primary" href="#download">Get the app free<\/a>/, '');
}
const source = new URL("../index.html", import.meta.url);
const destination = new URL("../download.html", import.meta.url);
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const generated = buildDownloadPage(fs.readFileSync(source, "utf8"));
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(destination, "utf8") !== generated)
      throw Error("Run node scripts/build-download-page.mjs to refresh the campaign page.");
  } else fs.writeFileSync(destination, generated);
}
