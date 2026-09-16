import { useMemo, useState } from "react";
import { loadDisplay, type StrengthSession } from "../../lib/strength/model";
import { strengthProgress } from "../../lib/strength/progress";
import "./StrengthProgress.css";

export function StrengthProgress({
  sessions,
  imperial,
}: {
  sessions: StrengthSession[];
  imperial: boolean;
}) {
  const records = useMemo(() => strengthProgress(sessions), [sessions]);
  const [selected, setSelected] = useState("");
  const record = records.find((r) => r.exerciseId === selected) ?? records[0];
  const display = (lbs?: number) =>
    lbs == null ? "—" : loadDisplay(lbs, imperial);
  const points =
    record?.observations.filter((p) => p.e1rmLbs != null).slice(-12) ?? [];
  const values = points.map((p) => p.e1rmLbs!);
  const low = Math.min(...values),
    high = Math.max(...values);
  const positions = points.map((p, i) => ({
    x: points.length === 1 ? 240 : 24 + (i * 432) / (points.length - 1),
    y: high === low ? 70 : 116 - ((p.e1rmLbs! - low) * 92) / (high - low),
  }));
  return (
    <div className="strength-progress">
      <section className="panel">
        <h2>Your strength over time</h2>
        <p>
          Records from your latest {sessions.length} saved workouts. Estimated
          max uses recorded external loads and 1–12 reps; it is not a tested
          one-rep maximum. Warm-ups, assistance, and ambiguous bodyweight loads
          do not create strength records.
        </p>
      </section>
      {record ? (
        <>
          <label>
            Exercise
            <select
              className="input"
              value={record.exerciseId}
              onChange={(e) => setSelected(e.target.value)}
            >
              {records.map((r) => (
                <option key={r.exerciseId} value={r.exerciseId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <div className="strength-progress-metrics">
            {[
              ["Estimated max", display(record.bestE1RMLbs)],
              ["Best set volume", display(record.bestSetVolumeLbs)],
              ["Best workout volume", display(record.bestSessionVolumeLbs)],
            ].map(([title, value]) => (
              <section className="panel" key={title}>
                <span>{title}</span>
                <strong>{value}</strong>
              </section>
            ))}
          </div>
          <section className="panel">
            <h3>Estimated max history</h3>
            {points.length ? (
              <>
                <svg
                  viewBox="0 0 480 140"
                  role="img"
                  aria-label={`Estimated external-load maximum across ${points.length} saved workouts. Exact values are listed below.`}
                >
                  <line
                    x1="24"
                    y1="125"
                    x2="456"
                    y2="125"
                    stroke="currentColor"
                    opacity=".2"
                  />
                  <polyline
                    points={positions.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="none"
                    stroke="#ff4757"
                    strokeWidth="3"
                  />
                  {positions.map((p, i) => (
                    <circle
                      key={points[i].sessionId}
                      cx={p.x}
                      cy={p.y}
                      r="5"
                      fill="#ff4757"
                    >
                      <title>
                        {points[i].date.toLocaleDateString()}:{" "}
                        {display(points[i].e1rmLbs)}
                      </title>
                    </circle>
                  ))}
                </svg>
                <p className="strength-progress-note">
                  Most recent recorded estimates, in workout order. Added-weight
                  bodyweight work contributes to load volume, but not estimated
                  max.
                </p>
              </>
            ) : (
              <p>
                No eligible external-load estimates yet. Your completed work is
                still recorded in history.
              </p>
            )}
            <div
              className="strength-progress-table"
              role="region"
              aria-label="Exercise progress history"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th>Workout date</th>
                    <th>Estimated max</th>
                    <th>Working load volume</th>
                  </tr>
                </thead>
                <tbody>
                  {record.observations
                    .slice(-12)
                    .reverse()
                    .map((point) => (
                      <tr key={point.sessionId}>
                        <td>{point.date.toLocaleDateString()}</td>
                        <td>{display(point.e1rmLbs)}</td>
                        <td>{display(point.volumeLbs)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h3>Best load at each rep count</h3>
            {Object.keys(record.bestWeightByReps).length ? (
              <ul className="strength-rep-records">
                {Object.entries(record.bestWeightByReps)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([reps, weight]) => (
                    <li key={reps}>
                      <span>
                        {reps} {reps === "1" ? "rep" : "reps"}
                      </span>
                      <strong>{display(weight)}</strong>
                    </li>
                  ))}
              </ul>
            ) : (
              <p>No eligible load records yet.</p>
            )}
          </section>
        </>
      ) : (
        <section className="strength-empty">
          <h3>Your progress starts with a saved workout</h3>
          <p>
            Use an exercise from the library, record your completed sets, and
            save your workout to see its history here.
          </p>
        </section>
      )}
    </div>
  );
}
