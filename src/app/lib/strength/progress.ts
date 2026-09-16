import { strengthTotals, type StrengthSession } from "./model.ts";

export interface StrengthObservation {
  sessionId: string;
  date: Date;
  e1rmLbs?: number;
  volumeLbs?: number;
}
export interface StrengthRecord {
  exerciseId: string;
  name: string;
  bestE1RMLbs?: number;
  bestWeightByReps: Record<number, number>;
  bestSetVolumeLbs?: number;
  bestSessionVolumeLbs?: number;
  observations: StrengthObservation[];
}
/** Matches the native Epley record policy; an estimate, never a tested max. */
export function estimatedStrengthMax(
  weightLbs: number,
  reps: number,
): number | undefined {
  if (
    !Number.isFinite(weightLbs) ||
    weightLbs <= 0 ||
    !Number.isInteger(reps) ||
    reps < 1 ||
    reps > 12
  )
    return undefined;
  const value = reps === 1 ? weightLbs : weightLbs * (1 + reps / 30);
  return Number.isFinite(value) ? value : undefined;
}
export function strengthProgress(
  sessions: StrengthSession[],
): StrengthRecord[] {
  const result = new Map<string, StrengthRecord>();
  for (const session of [...sessions]
    .filter((s) => s.status === "completed")
    .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())) {
    const sessionRecords = new Map<string, StrengthObservation>();
    for (const entry of session.entries) {
      if (!entry.exerciseId || !entry.sets.some((set) => set.isCompleted))
        continue;
      let record = result.get(entry.exerciseId);
      if (!record) {
        record = {
          exerciseId: entry.exerciseId,
          name: entry.name,
          bestWeightByReps: {},
          observations: [],
        };
        result.set(entry.exerciseId, record);
      }
      record.name = entry.name;
      let point = sessionRecords.get(entry.exerciseId);
      if (!point) {
        point = { sessionId: session.id, date: session.startDate };
        sessionRecords.set(entry.exerciseId, point);
      }
      const volume = strengthTotals({ ...session, entries: [entry] }).volumeLbs;
      if (volume > 0 && Number.isFinite((point.volumeLbs ?? 0) + volume))
        point.volumeLbs = (point.volumeLbs ?? 0) + volume;
      const ambiguous =
        entry.equipment === "bodyweight" ||
        /assisted/i.test(entry.name) ||
        ["machine-assisted-pull-up", "machine-assisted-dip"].includes(
          entry.exerciseId,
        );
      for (const set of entry.sets) {
        if (
          !set.isCompleted ||
          set.setType === "warmup" ||
          entry.measure === "time" ||
          (ambiguous && !set.loadKind) ||
          (set.loadKind != null && set.loadKind !== "externalWeight")
        )
          continue;
        const weight = set.weightLbs,
          reps = set.reps;
        if (
          weight == null ||
          !Number.isFinite(weight) ||
          weight <= 0 ||
          reps == null ||
          !Number.isInteger(reps) ||
          reps <= 0
        )
          continue;
        record.bestWeightByReps[reps] = Math.max(
          record.bestWeightByReps[reps] ?? 0,
          weight,
        );
        const setVolume = weight * reps;
        if (Number.isFinite(setVolume))
          record.bestSetVolumeLbs = Math.max(
            record.bestSetVolumeLbs ?? 0,
            setVolume,
          );
        const estimate = estimatedStrengthMax(weight, reps);
        if (estimate != null) {
          record.bestE1RMLbs = Math.max(record.bestE1RMLbs ?? 0, estimate);
          point.e1rmLbs = Math.max(point.e1rmLbs ?? 0, estimate);
        }
      }
    }
    for (const [id, point] of sessionRecords) {
      const record = result.get(id)!;
      record.observations.push(point);
      if (point.volumeLbs != null)
        record.bestSessionVolumeLbs = Math.max(
          record.bestSessionVolumeLbs ?? 0,
          point.volumeLbs,
        );
    }
  }
  return [...result.values()].sort((a, b) => a.name.localeCompare(b.name));
}
