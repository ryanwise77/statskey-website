import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  analyticsAllowed,
  CONSENT_KEY,
  initCampaignJourney,
  publicDestination,
  progressBucket,
} from "../src/campaignJourney.js";
import { buildDownloadPage } from "./build-download-page.mjs";
const store = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};
class Surface {
  constructor() {
    this.listeners = new Map();
    this.dataset = {};
    this.hidden = false;
  }
  addEventListener(name, fn) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), fn]);
  }
  removeEventListener(name, fn) {
    this.listeners.set(
      name,
      (this.listeners.get(name) || []).filter((f) => f !== fn),
    );
  }
  fire(name, value = {}) {
    for (const fn of this.listeners.get(name) || []) fn(value);
  }
  setAttribute(name, value) {
    this[name] = value;
  }
  getAttribute(name) {
    return this[name];
  }
  focus() {}
}
function page({
  consent,
  path = "/download",
  privacy = false,
  reject = false,
  hidden = false,
  sections = false,
} = {}) {
  const view = new Surface(),
    doc = new Surface(),
    ios = new Surface(),
    posted = [],
    scripts = [],
    nodes = new Map();
  const section = new Surface();
  section.dataset.analyticsSection = "strength";
  for (const selector of [
    "[data-analytics-allow]",
    "[data-analytics-decline]",
    "p",
  ])
    nodes.set(selector, new Surface());
  let timer,
    time = 0,
    observe;
  view.localStorage = store();
  view.sessionStorage = store();
  if (consent) view.localStorage.setItem(CONSENT_KEY, consent);
  Object.assign(view, {
    location: {
      pathname: path,
      origin: "https://statskey.ai",
      search:
        "?utm_source=youtube&utm_medium=paid_video&utm_campaign=youtube_ads",
    },
    navigator: { globalPrivacyControl: privacy },
    crypto: webcrypto,
    performance: { now: () => time },
    innerWidth: 390,
    innerHeight: 800,
    scrollY: 0,
    setInterval: (fn) => {
      timer = fn;
      return 1;
    },
    clearInterval: () => {
      timer = undefined;
    },
    fetch: async (_url, options) => {
      posted.push(JSON.parse(options.body));
      if (reject) throw Error("offline");
      return { ok: true };
    },
  });
  Object.assign(doc, {
    hidden,
    defaultView: view,
    documentElement: { scrollHeight: 2400 },
    head: { append: (script) => scripts.push(script) },
    body: {
      append: (node) => {
        doc.choice = node;
      },
    },
    createElement: () => {
      const n = new Surface();
      n.querySelector = (s) => nodes.get(s);
      return n;
    },
    querySelectorAll: (selector) =>
      selector === '[data-store="ios"]'
        ? [ios]
        : sections && selector === "[data-analytics-section]"
          ? [section]
          : [],
  });
  if (sections)
    view.IntersectionObserver = class {
      constructor(callback) { observe = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  initCampaignJourney(doc);
  return {
    view,
    doc,
    ios,
    posted,
    scripts,
    intersect: (isIntersecting) => observe?.([{ target: section, isIntersecting }]),
    allow: () => nodes.get("[data-analytics-allow]").fire("click"),
    decline: () => nodes.get("[data-analytics-decline]").fire("click"),
    tick: () => {
      time += 10000;
      timer?.();
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("campaign page stays generated from the full homepage and removes the rejected screenshot directory", () => {
  const home = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const landing = readFileSync(
    new URL("../download.html", import.meta.url),
    "utf8",
  );
  assert.equal(landing, buildDownloadPage(home));
  assert.doesNotMatch(home, /Your day, connected\.|id="app-features"/);
  for (const section of [
    "strength",
    "experiment-001",
    "founder-live",
    "positioning",
    "download",
  ])
    assert.ok(landing.includes(`id="${section}"`));
});
test("public click classification never includes query strings, account ids or health content", () => {
  assert.equal(publicDestination("/app/health?secret=private"), "web-app");
  assert.equal(
    publicDestination("/clinician/record/sensitive-id"),
    "marathon-record",
  );
  assert.equal(publicDestination("/#experiment-001"), "marathon");
  assert.equal(
    publicDestination("https://untrusted.example/steal?email=private"),
    "other-public-link",
  );
  assert.equal(progressBucket(62.6), 50);
  assert.equal(progressBucket(Infinity), 0);
});
test("no tracking requests or advertising scripts before choice; download attribution still works", () => {
  const p = page();
  assert.equal(p.posted.length, 0);
  assert.equal(p.scripts.length, 0);
  assert.equal(new URL(p.ios.href).hostname, "apps.apple.com");
  assert.equal(new URL(p.ios.href).searchParams.get("ct"), "youtube_ads");
  p.decline();
  p.tick();
  assert.equal(p.posted.length, 0);
});
test("consented visit records ordered public events and shares its visit id with store clicks", async () => {
  const p = page({ consent: "allowed" });
  await settle();
  assert.equal(p.posted[0].events[0].type, "page_view");
  assert.equal(p.posted[0].device, "phone");
  assert.equal(
    p.posted[0].visitId,
    new URL(p.ios.href).searchParams.get("visitId"),
  );
  p.view.scrollY = 850;
  p.view.fire("scroll");
  p.tick();
  await settle();
  const events = p.posted.flatMap((x) => x.events);
  assert.deepEqual(
    events.map((x) => x.type),
    ["page_view", "scroll_depth", "engagement"],
  );
  assert.equal(events[1].value, 50);
  assert.deepEqual(
    events.map((x) => x.sequence),
    [1, 2, 3],
  );
});
test("blocked transmission retries stable event ids and opt-out clears pending events", async () => {
  const p = page({ consent: "allowed", reject: true });
  await settle();
  p.tick();
  await settle();
  assert.equal(p.posted[0].events[0].id, p.posted[1].events[0].id);
  p.decline();
  const count = p.posted.length;
  p.tick();
  p.view.fire("scroll");
  await settle();
  assert.equal(p.posted.length, count);
  assert.equal(new URL(p.ios.href).hostname, "apps.apple.com");
});
test("privacy signals override saved permission and private app routes never initialize tracking", () => {
  const p = page({ consent: "allowed", privacy: true });
  p.allow();
  assert.equal(p.posted.length, 0);
  assert.equal(p.scripts.length, 0);
  assert.equal(
    analyticsAllowed(
      { navigator: { doNotTrack: "1" } },
      { getItem: () => "allowed" },
    ),
    false,
  );
  assert.equal(
    page({ consent: "allowed", path: "/app/strength" }).posted.length,
    0,
  );
});
test("private record controls are not recorded", async () => {
  const p = page({ consent: "allowed" });
  await settle();
  p.doc.fire("click", { target: { closest: () => ({ closest: () => true }) } });
  p.tick();
  await settle();
  assert.equal(
    p.posted.flatMap((x) => x.events).some((x) => x.type === "click"),
    false,
  );
});
test("background tabs defer their page view and visible sections until activation, without counting hidden time", async () => {
  const p = page({ consent: "allowed", hidden: true, sections: true });
  p.intersect(true);
  p.tick();
  await settle();
  assert.equal(p.posted.length, 0);
  p.doc.hidden = false;
  p.doc.fire("visibilitychange");
  await settle();
  assert.deepEqual(p.posted.flatMap(batch => batch.events).map(event => event.type), ["page_view", "section_view"]);
  p.doc.hidden = true;
  p.doc.fire("visibilitychange");
  p.tick();
  p.doc.hidden = false;
  p.doc.fire("visibilitychange");
  p.intersect(true);
  p.tick();
  await settle();
  const events = p.posted.flatMap(batch => batch.events);
  assert.deepEqual(events.map(event => event.type), ["page_view", "section_view", "engagement"]);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3]);
  assert.equal(events.at(-1).value, 10);
});
test("a section that leaves the viewport while hidden is not falsely counted when the tab becomes visible", async () => {
  const p = page({ consent: "allowed", hidden: true, sections: true });
  p.intersect(true);
  p.intersect(false);
  p.doc.hidden = false;
  p.doc.fire("visibilitychange");
  await settle();
  assert.deepEqual(p.posted.flatMap(batch => batch.events).map(event => event.type), ["page_view"]);
  p.intersect(true);
  p.tick();
  await settle();
  assert.equal(p.posted.flatMap(batch => batch.events).filter(event => event.type === "section_view").length, 1);
});
