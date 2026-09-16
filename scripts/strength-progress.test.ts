import test from "node:test";
import assert from "node:assert/strict";
import {
  estimatedStrengthMax,
  strengthProgress,
} from "../src/app/lib/strength/progress.ts";
import { newSession, newExercise } from "../src/app/lib/strength/model.ts";
function completed() {
  const s = newSession("owner", new Date("2026-09-01T12:00:00Z"));
  s.status = "completed";
  const e = newExercise("Bench", "barbell", "reps", "bench");
  e.sets[0] = { ...e.sets[0], weightLbs: 100, reps: 10, isCompleted: true };
  s.entries = [e];
  return s;
}
test("native Epley estimate is bounded to 1–12 reps and rejects invalid/overflow values", () => {
  assert.equal(estimatedStrengthMax(100, 1), 100);
  assert.equal(estimatedStrengthMax(100, 6), 120);
  for (const [w, r] of [
    [100, 13],
    [100, 1.5],
    [0, 3],
    [Infinity, 3],
    [Number.MAX_VALUE, 12],
  ])
    assert.equal(estimatedStrengthMax(w, r), undefined);
});
test("records aggregate repeated exercise entries into one workout observation without mutating history", () => {
  const s = completed();
  s.entries.push({ ...s.entries[0], id: "second" });
  const result = strengthProgress([s]);
  assert.equal(result[0].observations.length, 1);
  assert.equal(result[0].bestSessionVolumeLbs, 2000);
  assert.equal(result[0].bestSetVolumeLbs, 1000);
  assert.equal(result[0].bestWeightByReps[10], 100);
  assert.equal(s.entries.length, 2);
});
test("assistance, bodyweight, warmups, uncompleted and unknown identities cannot invent records", () => {
  for (const kind of ["assistance", "bodyweightOnly"] as const) {
    const s = completed();
    s.entries[0].sets[0].loadKind = kind;
    const r = strengthProgress([s])[0];
    assert.equal(r.bestE1RMLbs, undefined);
    assert.equal(r.bestSessionVolumeLbs, undefined);
  }
  const s = completed();
  s.entries[0].equipment = "bodyweight";
  assert.equal(strengthProgress([s])[0].bestE1RMLbs, undefined);
  s.entries[0].equipment = "barbell";
  s.entries[0].sets[0].setType = "warmup";
  assert.equal(strengthProgress([s])[0].bestE1RMLbs, undefined);
  s.entries[0].sets[0].isCompleted = false;
  assert.deepEqual(strengthProgress([s]), []);
  s.entries[0].sets[0].isCompleted = true;
  s.entries[0].exerciseId = "";
  assert.deepEqual(strengthProgress([s]), []);
});
test("added weight counts load volume but cannot be promoted to total-load estimated max", () => {
  const s = completed();
  s.entries[0].equipment = "bodyweight";
  s.entries[0].sets[0].loadKind = "addedWeight";
  const r = strengthProgress([s])[0];
  assert.equal(r.bestSessionVolumeLbs, 1000);
  assert.equal(r.bestE1RMLbs, undefined);
  assert.deepEqual(r.bestWeightByReps, {});
});
