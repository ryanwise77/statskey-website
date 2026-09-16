import { applyStoreLinks, getStoreVisitID, readStoreCampaign } from "./storeLinks.js";

export const JOURNEY_ENDPOINT =
  "https://us-central1-statskey.cloudfunctions.net/recordCampaignJourney";
export const CONSENT_KEY = "statskey:website-analytics:v1";
export const VISIT_KEY = "statskey:mobile-download-visit:v1";
export const TARGETS = [
  "home",
  "campaign",
  "welcome",
  "strength",
  "marathon",
  "get-app",
  "positioning",
  "pricing",
  "nutrition",
  "features",
  "ios",
  "android",
  "desktop",
  "web-app",
  "care",
  "wellness",
  "hardware",
  "mindscape",
  "support",
  "privacy",
  "terms",
  "marathon-record",
  "marathon-video",
  "instagram",
  "strength-plan",
  "strength-train",
  "strength-review",
  "menu",
  "other-public-link",
];
export function publicDestination(href, origin = "https://statskey.ai") {
  try {
    const url = new URL(href, origin);
    if (url.origin === origin) {
      if (url.hash)
        return (
          {
            "#experiment-001": "marathon",
            "#founder-live": "marathon-record",
            "#strength": "strength",
            "#download": "get-app",
            "#positioning": "positioning",
            "#gut": "wellness",
            "#pricing": "pricing",
          }[url.hash] || "other-public-link"
        );
      const path = url.pathname.replace(/\/$/, "") || "/";
      if (path.startsWith("/app")) return "web-app";
      if (path.startsWith("/clinician")) return "marathon-record";
      if (path.includes("olympic-marathon-experiment")) return "marathon-video";
      return (
        {
          "/": "home",
          "/download": "get-app",
          "/desktop": "desktop",
          "/care": "care",
          "/wellness": "wellness",
          "/hardware": "hardware",
          "/mindscape": "mindscape",
          "/support": "support",
          "/privacy": "privacy",
          "/terms": "terms",
        }[path] || "other-public-link"
      );
    }
    if (url.hostname === "apps.apple.com") return "ios";
    if (url.hostname === "play.google.com") return "android";
    if (url.hostname === "www.instagram.com") return "instagram";
    return "other-public-link";
  } catch {
    return null;
  }
}
export function progressBucket(value) {
  return Number.isFinite(value)
    ? Math.min(100, Math.max(0, Math.floor(value / 25) * 25))
    : 0;
}
export function analyticsAllowed(view, storage) {
  if (
    view.navigator?.globalPrivacyControl === true ||
    view.navigator?.doNotTrack === "1"
  )
    return false;
  try {
    return storage?.getItem(CONSENT_KEY) === "allowed";
  } catch {
    return false;
  }
}
function pixels(view, doc) {
  if (view.__statskeyPixelsLoaded) return;
  view.__statskeyPixelsLoaded = true;
  view.dataLayer = view.dataLayer || [];
  view.gtag =
    view.gtag ||
    function () {
      view.dataLayer.push(arguments);
    };
  view.gtag("consent", "default", {
    analytics_storage: "granted",
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
  });
  view.gtag("js", new Date());
  view.gtag("config", "AW-18341057139");
  const google = doc.createElement("script");
  google.src = "https://www.googletagmanager.com/gtag/js?id=AW-18341057139";
  google.async = true;
  doc.head.append(google);
  if (!view.rdt) {
    const rdt = (...args) =>
      rdt.sendEvent ? rdt.sendEvent(...args) : rdt.callQueue.push(args);
    rdt.callQueue = [];
    view.rdt = rdt;
    const reddit = doc.createElement("script");
    reddit.src = "https://www.redditstatic.com/ads/pixel.js";
    reddit.async = true;
    doc.head.append(reddit);
  }
  view.rdt("init", "a2_jjx75kx20ekq");
  view.rdt("track", "PageVisit");
}
export function initCampaignJourney(doc = document) {
  const view = doc.defaultView;
  if (
    !view ||
    !["/", "/index.html", "/download", "/download/", "/download.html"].includes(
      view.location.pathname,
    )
  )
    return;
  let storage, consentStorage;
  try {
    storage = view.sessionStorage;
  } catch {
    /* Blocked storage does not block the site. */
  }
  try {
    consentStorage = view.localStorage;
  } catch {
    /* In-memory choice still works for this page. */
  }
  const campaign = readStoreCampaign(view.location.search, storage) || {
    utm_source: "direct",
    utm_medium: "none",
    utm_campaign: "direct",
  };
  let allowed = analyticsAllowed(view, consentStorage);
  const privacySignal =
    view.navigator.globalPrivacyControl === true ||
    view.navigator.doNotTrack === "1";
  let queue = [],
    started = false,
    sequence = 0,
    total = 0,
    busy = false,
    elapsed = 0,
    visibleAt = null;
  let visitId, pageId, interval, observer;
  const begin = view.performance.now();
  const cleanup = [];
  const on = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    cleanup.push(() => target.removeEventListener(type, fn, options));
  };
  function record(type, target, value) {
    if (!allowed || doc.hidden || total >= 500 || !TARGETS.includes(target))
      return false;
    queue.push({
      id: view.crypto.randomUUID(),
      sequence: ++sequence,
      type,
      target,
      ...(value == null ? {} : { value }),
      elapsedMs: Math.min(86400000, Math.round(view.performance.now() - begin)),
    });
    total++;
    if (queue.length >= 20) void flush();
    return true;
  }
  async function flush(beacon = false) {
    if (!allowed || !queue.length || (busy && !beacon)) return;
    const events = queue.slice(0, 40);
    const payload = JSON.stringify({
      version: 1,
      visitId,
      pageId,
      campaign,
      device:
        view.innerWidth < 600
          ? "phone"
          : view.innerWidth < 1100
            ? "tablet"
            : "desktop",
      events,
    });
    if (
      beacon &&
      view.navigator.sendBeacon?.(
        JOURNEY_ENDPOINT,
        new Blob([payload], { type: "text/plain" }),
      )
    ) {
      queue.splice(0, events.length);
      return;
    }
    busy = true;
    try {
      const response = await view.fetch(JOURNEY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: payload,
        credentials: "omit",
        keepalive: true,
      });
      if (response.ok)
        queue = queue.filter(
          (event) => !events.some((sent) => sent.id === event.id),
        );
    } catch {
      /* Retry the same event IDs on the next flush; navigation remains immediate. */
    } finally {
      busy = false;
    }
  }
  function engagement() {
    if (visibleAt != null) elapsed += view.performance.now() - visibleAt;
    visibleAt = doc.hidden ? null : view.performance.now();
    if (allowed && total < 500 && elapsed >= 1000) {
      total++;
      // Hidden pages still send their last visible interval; never count background time.
      queue.push({
        id: view.crypto.randomUUID(),
        sequence: ++sequence,
        type: "engagement",
        target: "home",
        value: Math.min(86400, Math.round(elapsed / 1000)),
        elapsedMs: Math.min(
          86400000,
          Math.round(view.performance.now() - begin),
        ),
      });
      elapsed = 0;
    }
  }
  function start() {
    applyStoreLinks(doc, { track: allowed });
    if (!allowed || started || !view.crypto?.randomUUID) return;
    started = true;
    visitId = getStoreVisitID(view, storage);
    pageId = view.crypto.randomUUID();
    visibleAt = doc.hidden ? null : view.performance.now();
    pixels(view, doc);
    let pageViewed = false;
    function recordPageView() {
      if (!pageViewed)
        pageViewed = record(
          "page_view",
          view.location.pathname.startsWith("/download") ? "campaign" : "home",
        );
    }
    recordPageView();
    let depth = 0;
    on(
      view,
      "scroll",
      () => {
        const scrollable = doc.documentElement.scrollHeight - view.innerHeight;
        const next = progressBucket(
          scrollable > 0 ? (100 * view.scrollY) / scrollable : 100,
        );
        if (next > depth) {
          depth = next;
          record("scroll_depth", "home", depth);
        }
      },
      { passive: true },
    );
    on(
      doc,
      "click",
      (event) => {
        const link = event.target.closest?.("a, button, summary");
        if (
          !link ||
          link.closest("#founder-live") ||
          link.closest(".site-analytics-choice") ||
          link.matches("[data-analytics-settings]")
        )
          return;
        let target =
          link.dataset.store === "play"
            ? "android"
            : link.dataset.store === "ios"
              ? "ios"
              : link.dataset.strengthTab
                ? `strength-${link.dataset.strengthTab}`
                : link.id === "mobile-menu-btn"
                  ? "menu"
                  : link.matches("a")
                    ? publicDestination(link.href, view.location.origin)
                    : null;
        if (target) {
          record("click", target);
          if (link.matches("a")) void flush(true);
        }
      },
      true,
    );
    let recordVisibleSections = () => {};
    if ("IntersectionObserver" in view) {
      const seen = new Set();
      const visible = new Map();
      recordVisibleSections = () => {
        for (const [key, section] of visible) {
          if (!seen.has(key) && record("section_view", key)) {
            seen.add(key);
            visible.delete(key);
            observer.unobserve(section);
          }
        }
      };
      observer = new view.IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const key = entry.target.dataset.analyticsSection;
            if (entry.isIntersecting && !seen.has(key))
              visible.set(key, entry.target);
            else visible.delete(key);
          });
          recordVisibleSections();
        },
        { threshold: 0, rootMargin: "-15% 0px -15% 0px" },
      );
      doc
        .querySelectorAll("[data-analytics-section]")
        .forEach((section) => observer.observe(section));
    }
    doc.querySelectorAll("video").forEach((video) => {
      let bucket = -1;
      on(video, "timeupdate", () => {
        if (video.paused || !Number.isFinite(video.duration)) return;
        const next = progressBucket((100 * video.currentTime) / video.duration);
        if (next > bucket) {
          bucket = next;
          record(
            "video_progress",
            video.closest("#experiment-001") ? "marathon-video" : "welcome",
            next,
          );
        }
      });
    });
    on(doc, "visibilitychange", () => {
      engagement();
      if (doc.hidden) void flush(true);
      else {
        // A background tab is counted when it is first viewed. Observer
        // callbacks can arrive while hidden, so defer those sections too.
        recordPageView();
        recordVisibleSections();
        void flush();
      }
    });
    on(view, "pagehide", () => {
      engagement();
      void flush(true);
    });
    interval = view.setInterval(() => {
      if (!doc.hidden) engagement();
      void flush();
    }, 10000);
    void flush();
  }
  const choice = doc.createElement("aside");
  choice.className = "site-analytics-choice";
  choice.setAttribute("aria-label", "Website analytics choices");
  choice.innerHTML =
    '<strong>Help shape a better StatsKey.</strong><p>Allow website analytics and advertising pixels to measure visits, sections viewed, clicks, and video progress. This does not record your health data, typed text, or private app screens.</p><div><button type="button" data-analytics-allow>Allow analytics</button><button type="button" data-analytics-decline>Decline</button><a href="/privacy#website-analytics">Details</a></div>';
  let saved = null;
  try {
    saved = consentStorage?.getItem(CONSENT_KEY);
  } catch {
    /* Show choices. */
  }
  choice.hidden = privacySignal || saved === "allowed" || saved === "declined";
  doc.body.append(choice);
  function choose(next) {
    allowed = next && !privacySignal;
    try {
      consentStorage?.setItem(CONSENT_KEY, allowed ? "allowed" : "declined");
    } catch {
      /* Current-page choice remains effective. */
    }
    choice.hidden = true;
    if (!allowed) {
      queue = [];
      observer?.disconnect();
      view.clearInterval(interval);
      cleanup.splice(0).forEach((fn) => fn());
      started = false;
      view.gtag?.("consent", "update", {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      });
    } else {
      view.gtag?.("consent", "update", {
        analytics_storage: "granted",
        ad_storage: "granted",
        ad_user_data: "granted",
        ad_personalization: "granted",
      });
    }
    start();
    // Reload unloads previously allowed third-party scripts after withdrawal.
    if (!allowed && view.__statskeyPixelsLoaded) view.location.reload?.();
  }
  choice
    .querySelector("[data-analytics-allow]")
    .addEventListener("click", () => choose(true));
  choice
    .querySelector("[data-analytics-decline]")
    .addEventListener("click", () => choose(false));
  if (privacySignal) {
    choice.querySelector("[data-analytics-allow]").disabled = true;
    choice.querySelector("p").textContent =
      "Website analytics are off because your browser sends a privacy preference. Your download links still work.";
  }
  doc.querySelectorAll("[data-analytics-settings]").forEach((button) =>
    button.addEventListener("click", () => {
      choice.hidden = false;
      choice.querySelector("[data-analytics-decline]").focus();
    }),
  );
  start();
}
