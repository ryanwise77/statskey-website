import { useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import { auth } from "../lib/firebase";
import "./Campaigns.css";

type Campaign = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content?: string;
  utm_term?: string;
};
type Metrics = {
  visits?: number;
  eventCount?: number;
  engagementSeconds?: number;
  byType?: Record<string, number>;
  clicks?: Record<string, number>;
  sections?: Record<string, number>;
};
type CampaignRow = Metrics & { campaignKey: string; campaign: Campaign };
type Visit = Metrics & {
  visitHash: string;
  firstReceivedAt: string;
  lastReceivedAt: string;
  firstCampaign: Campaign;
  lastCampaign: Campaign;
  device: string;
  pageCount: number;
};
type JourneyEvent = {
  id: string;
  pageHash: string;
  sequence: number;
  type: string;
  target: string;
  value?: number;
  elapsedMs: number;
  receivedAt: string;
  campaign: Campaign;
};
type StoreClick = {
  id: string;
  store: string;
  receivedAt: string;
  campaign: string;
};
type Summary = {
  start: string;
  end: string;
  days: Metrics[];
  campaigns: CampaignRow[];
  visits: Visit[];
  campaignsTruncated: boolean;
  visitsLimit: number;
};
type Detail = {
  visit: Visit | null;
  events: JourneyEvent[];
  storeClicks?: StoreClick[];
  storeClicksTruncated?: boolean;
};
const endpoint =
  "https://us-central1-statskey.cloudfunctions.net/getCampaignJourney";
const label = (text: string) => text.replaceAll("_", " ").replaceAll("-", " ");
const count = (value?: number) => (value ?? 0).toLocaleString();
const when = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString()
    : "Time unavailable";
};
function duration(seconds = 0) {
  return seconds < 60
    ? `${Math.round(seconds)}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function Campaigns() {
  const { user } = useAuth();
  return user ? <CampaignWorkspace key={user.uid} uid={user.uid} /> : null;
}
function CampaignWorkspace({ uid }: { uid: string }) {
  const [days, setDays] = useState("7"),
    [refresh, setRefresh] = useState(0);
  const [summary, setSummary] = useState<Summary | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [selected, setSelected] = useState(""),
    [source, setSource] = useState("all");
  const [loading, setLoading] = useState(false),
    [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(""),
    [detailError, setDetailError] = useState("");
  const [detailRefresh, setDetailRefresh] = useState(0);
  const request = useRef(0),
    detailRequest = useRef(0);
  async function read<T>(body: object, signal: AbortSignal): Promise<T> {
    const user = auth.currentUser;
    if (user?.uid !== uid)
      throw Error("Sign in again to open campaign analytics.");
    const token = await user.getIdToken();
    if (auth.currentUser?.uid !== uid || signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    const result = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      credentials: "omit",
      body: JSON.stringify(body),
      signal,
    });
    if (!result.ok)
      throw Error(
        result.status === 403
          ? "Campaign analytics are available only to the StatsKey founder account."
          : result.status === 401
            ? "Your sign-in expired. Sign in again to continue."
            : "Campaign analytics could not be loaded. Please try again.",
      );
    const data = (await result.json()) as T;
    if (auth.currentUser?.uid !== uid || signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    return data;
  }
  useEffect(() => {
    const controller = new AbortController(),
      id = ++request.current;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setLoading(true);
    setError("");
    setSummary(null);
    setSelected("");
    setDetail(null);
    read<Summary>(
      { mode: "summary", days: Number(days), limit: 100 },
      controller.signal,
    )
      .then((value) => {
        if (request.current === id && !controller.signal.aborted)
          setSummary(value);
      })
      .catch((e) => {
        if (request.current === id)
          setError(
            controller.signal.aborted
              ? "The report took too long to load. Try refreshing."
              : e.message,
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (request.current === id) setLoading(false);
      });
    return () => {
      request.current++;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [uid, days, refresh]);
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    if (!selected) {
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController(),
      id = ++detailRequest.current;
    const timeout = setTimeout(() => controller.abort(), 30000);
    setDetailLoading(true);
    read<Detail>({ mode: "visit", visitHash: selected }, controller.signal)
      .then((value) => {
        if (detailRequest.current === id && !controller.signal.aborted)
          setDetail(value);
      })
      .catch((e) => {
        if (detailRequest.current === id)
          setDetailError(
            controller.signal.aborted
              ? "This visit took too long to load. Select it again to retry."
              : e.message,
          );
      })
      .finally(() => {
        clearTimeout(timeout);
        if (detailRequest.current === id) setDetailLoading(false);
      });
    return () => {
      detailRequest.current++;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [uid, selected, detailRefresh]);
  const campaigns =
    summary?.campaigns.filter(
      (row) => source === "all" || row.campaign.utm_source === source,
    ) ?? [];
  const visits =
    summary?.visits.filter(
      (row) => source === "all" || row.lastCampaign.utm_source === source,
    ) ?? [];
  const totals = summary?.days.reduce(
    (a, day) => ({
      views: a.views + (day.byType?.page_view ?? 0),
      visits: a.visits + (day.visits ?? 0),
      clicks: a.clicks + (day.clicks?.ios ?? 0) + (day.clicks?.android ?? 0),
      seconds: a.seconds + (day.engagementSeconds ?? 0),
    }),
    { views: 0, visits: 0, clicks: 0, seconds: 0 },
  );
  return (
    <div className="campaign-report">
      <header>
        <div>
          <p className="text-text-muted">FOUNDER / CAMPAIGN ANALYTICS</p>
          <h1>From first visit to next move.</h1>
          <p>
            See which campaigns bring people in and the path each anonymous
            visit takes.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh
        </button>
      </header>
      <div className="campaign-controls">
        <label>
          Reporting window
          <select
            className="input"
            value={days}
            onChange={(e) => setDays(e.target.value)}
          >
            <option value="1">Today</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
          </select>
        </label>
        <label>
          Source filter
          <select
            className="input"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="all">All sources</option>
            {["youtube", "reddit", "tiktok", "meta", "google", "direct"].map(
              (s) => (
                <option key={s} value={s}>
                  {s === "direct" ? "Direct / other" : label(s)}
                </option>
              ),
            )}
          </select>
        </label>
      </div>
      {loading && <p role="status">Loading campaign activity…</p>}
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      {summary && (
        <>
          <p className="campaign-note">
            {summary.start} through {summary.end} · America/Chicago. Totals
            cover all sources. Visits below are the latest {summary.visitsLimit}
            . Only visitors who allow analytics are represented.
          </p>
          <div className="campaign-metrics">
            {[
              ["Page views", count(totals?.views)],
              ["Daily visits", count(totals?.visits)],
              ["Mobile store clicks", count(totals?.clicks)],
              ["Visible time", duration(totals?.seconds)],
            ].map(([name, value]) => (
              <div className="panel" key={name}>
                <strong>{value}</strong>
                <span>{name}</span>
              </div>
            ))}
          </div>
          <section className="panel">
            <h2>Campaign performance</h2>
            {campaigns.length ? (
              <div
                className="campaign-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Campaign performance"
              >
                <table>
                  <thead>
                    <tr>
                      <th>Campaign / creative</th>
                      <th>Source</th>
                      <th>Daily visits</th>
                      <th>Page views</th>
                      <th>iOS clicks</th>
                      <th>Android clicks</th>
                      <th>Visible time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((row) => (
                      <tr key={row.campaignKey}>
                        <td>
                          <strong>{row.campaign.utm_campaign}</strong>
                          {row.campaign.utm_content && (
                            <small>{row.campaign.utm_content}</small>
                          )}
                        </td>
                        <td>
                          {row.campaign.utm_source}
                          <small>{row.campaign.utm_medium}</small>
                        </td>
                        <td>{count(row.visits)}</td>
                        <td>{count(row.byType?.page_view)}</td>
                        <td>{count(row.clicks?.ios)}</td>
                        <td>{count(row.clicks?.android)}</td>
                        <td>{duration(row.engagementSeconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No campaign activity recorded for this selection yet.</p>
            )}
            {summary.campaignsTruncated && (
              <p className="campaign-note">
                The campaign list is limited. Choose a shorter reporting window
                to narrow the results.
              </p>
            )}
          </section>
          <div className="campaign-journeys">
            <section className="panel">
              <h2>Recent visits</h2>
              <p className="campaign-note">
                Anonymous sessions, with no account identity or private app
                activity.
              </p>
              {visits.length ? (
                <ul className="campaign-visits">
                  {visits.map((visit) => (
                    <li key={visit.visitHash}>
                      <button
                        aria-pressed={selected === visit.visitHash}
                        onClick={() => {
                          setSelected(visit.visitHash);
                          setDetailRefresh((n) => n + 1);
                        }}
                      >
                        <strong>{visit.lastCampaign.utm_campaign}</strong>
                        <span>
                          {visit.device} · {count(visit.eventCount)} events ·{" "}
                          {duration(visit.engagementSeconds)}
                        </span>
                        <small>{when(visit.lastReceivedAt)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No visits recorded yet.</p>
              )}
            </section>
            <section className="panel">
              <h2>Visit journey</h2>
              {detailLoading && <p role="status">Loading visit…</p>}
              {detailError && <p role="alert">{detailError}</p>}
              {!selected && <p>Select a visit to see its ordered timeline.</p>}
              {detail && (
                <>
                  <p className="campaign-note">
                    {detail.visit?.device} · Visit {selected.slice(0, 8)} ·
                    Events are grouped by page and ordered by event sequence.
                    Time is relative to that page opening.
                  </p>
                  {detail.events.length ? (
                    <ol className="campaign-timeline">
                      {detail.events.map((event, index) => (
                        <li key={event.id}>
                          {index === 0 ||
                          detail.events[index - 1].pageHash !==
                            event.pageHash ? (
                            <h3>
                              Page {event.pageHash.slice(0, 6)} ·{" "}
                              {when(event.receivedAt)}
                            </h3>
                          ) : null}
                          <div>
                            <time>+{duration(event.elapsedMs / 1000)}</time>
                            <span>
                              <strong>{label(event.type)}</strong> ·{" "}
                              {label(event.target)}
                              {event.value != null
                                ? ` · ${event.value}${event.type === "engagement" ? "s" : "%"}`
                                : ""}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p>No retained events for this visit.</p>
                  )}
                  {!!detail.storeClicks?.length && (
                    <>
                      <h3>Confirmed store handoffs</h3>
                      <ul>
                        {detail.storeClicks.map((click) => (
                          <li key={click.id}>
                            {label(click.store)} · {when(click.receivedAt)}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {detail.storeClicksTruncated && (
                    <p>Showing up to 200 recorded store handoffs.</p>
                  )}
                </>
              )}
            </section>
          </div>
          <p className="campaign-note">
            Store clicks and handoffs are not confirmed installs. Ad blockers,
            declined analytics, and interrupted connections can leave gaps.
            Visit events expire after 30 days.
          </p>
        </>
      )}
    </div>
  );
}
