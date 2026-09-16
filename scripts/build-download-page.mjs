import fs from "node:fs";
import { pathToFileURL } from "node:url";
export function buildDownloadPage(homepage) {
  return homepage
    .replace(
      '<body class="antialiased marketing-light">',
      '<body class="antialiased marketing-light campaign-landing">',
    )
    .replace(
      "<title>StatsKey | Energy Intelligence</title>",
      "<title>Make your next move count | StatsKey</title>",
    )
    .replace(
      'href="https://statskey.ai/"',
      'href="https://statskey.ai/download"',
    )
    .replaceAll('content="StatsKey | Energy Intelligence"', 'content="Make your next move count | StatsKey"')
    .replace(
      'content="https://statskey.ai/"',
      'content="https://statskey.ai/download"',
    )
    .replace(
      "Your body is a dataset StatsKey makes legible.",
      "Make your next<br>move count.",
    )
    .replace(
      '<div class="eyebrow reveal">Energy intelligence</div>',
      '<div class="eyebrow reveal">YOUR TRAINING. YOUR NUTRITION. YOUR NEXT CHAPTER.</div>',
    )
    .replace(
      "Record meals, plan your training, track strength and activity, and connect your health history. Bring it together with Intelligence and insights you can review.",
      "Big goals start with the everyday. Bring your training, meals, and recovery together in StatsKey — and see what you’re building, one day at a time.",
    )
    .replace(
      /<div class="hero-note reveal d3">[\s\S]*?<\/div>/,
      '<div class="hero-note reveal d3">Free to download. Optional Pro and Pro+ plans. <a href="/app/tokens">Compare plans →</a></div>',
    )
    .replaceAll('href="/download"', 'href="#download"')
    .replace(
      '<a class="button button--primary" href="#download">Get the app free</a>',
      '<a class="button button--primary" href="#experiment-001">Follow the marathon experiment <span aria-hidden="true">↓</span></a>',
    )
    .replace(
      "Preview Strength. Plan, train, and review.",
      "Explore Strength. Make every set count.",
    );
}
const source = new URL("../index.html", import.meta.url);
const destination = new URL("../download.html", import.meta.url);
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const generated = buildDownloadPage(fs.readFileSync(source, "utf8"));
  if (process.argv.includes("--check")) {
    if (fs.readFileSync(destination, "utf8") !== generated)
      throw Error(
        "Run node scripts/build-download-page.mjs to refresh the campaign page.",
      );
  } else fs.writeFileSync(destination, generated);
}
