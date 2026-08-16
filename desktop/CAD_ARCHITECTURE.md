# StatsKey CAD architecture decision

Status: accepted for the first production vertical slice (2026-08-15)

## Decision

StatsKey CAD uses:

- `manifold-3d` as the WebAssembly solid-modeling kernel behind a worker boundary
- Three.js for viewport rendering and interaction
- a versioned parametric document rebuilt from typed, deterministic commands
- the same command transactions for manual and agent-originated edits
- StatsKey-owned binary STL and closed faceted STEP serialization with validation

The command/document model is the durable product contract. Geometry generation is
an adapter so a future exact B-Rep kernel can be introduced without replacing
feature history, agent previews, undo/redo, serialization, or manual tools.

## Considered approaches

1. **Manifold + Three.js — selected.** Robust manifold mesh Booleans, a compact
   WebAssembly distribution, permissive Apache-2.0/MIT licensing, and
   browser/Electron portability made it the best fit for a coherent macOS and
   Windows vertical slice.
2. **Replicad + OpenCascade.js.** Stronger exact B-Rep and exchange capabilities,
   but a larger runtime and LGPL obligations for the OpenCascade distribution.
   It remains a possible future backend after an explicit product and licensing
   review.
3. **JSCAD.** Permissively licensed and portable, but less aligned with the
   deterministic mechanical feature/history and validated solid-export contract
   required for this milestone.

## Trust and interoperability contract

- Agent plans never mutate geometry directly. They preview and execute ordinary
  typed commands against a pinned document fingerprint.
- Every accepted transaction records its commands and before/after fingerprints
  for inspection, replay, undo, and redo.
- Invalid documents and impossible operations fail before replacing the current
  document.
- Geometry rebuilds run off the UI thread and report revision-tagged results.
- STEP and STL downloads are gated on a successful rebuild of the current
  document revision and independent format validation.
- Manual modeling remains local and does not require a cloud service.

## Known boundary

The current STEP output is a validated closed faceted B-Rep, not an exact
analytic B-Rep. Curves therefore exchange as facets. Exact NURBS/analytic
surfaces, assemblies, drawings, and standards-grade constraint solving belong
to a later kernel/interoperability milestone.
