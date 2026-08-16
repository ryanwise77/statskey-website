import { describe, expect, it } from 'vitest'
import { proposeCadAgentAction } from './agent'
import {
  CadCommandError,
  applyCadTransaction,
  cadDocumentFingerprint,
  createCadDocument,
  createLineEntity,
  createSketchFeature,
  createCadTransaction,
  createMountingPlateTransaction,
  decodeCadDocument,
  replayCadHistory,
  serializeCadDocument,
  sketchRectangleDimensions,
} from './document'
import {
  createCadSession,
  executeCadTransaction,
  loadCadSession,
  redoCadSession,
  saveCadSession,
  undoCadSession,
} from './session'
import type { CadSketchFeature } from './types'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() {
    return this.values.size
  }

  clear() {
    this.values.clear()
  }

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

function plateSketch(
  document: ReturnType<typeof createCadDocument>
): CadSketchFeature {
  const sketch = document.features.find(
    (feature): feature is CadSketchFeature => feature.kind === 'sketch'
  )
  if (!sketch) throw new Error('Missing plate sketch')
  return sketch
}

describe('parametric CAD document', () => {
  it('creates the acceptance plate as four editable deterministic features', () => {
    const document = applyCadTransaction(
      createCadDocument('Acceptance plate', 1),
      createMountingPlateTransaction('manual', undefined, 2)
    )

    expect(document.features.map((feature) => feature.kind)).toEqual([
      'sketch',
      'extrude',
      'hole',
      'fillet',
    ])
    expect(sketchRectangleDimensions(plateSketch(document))).toMatchObject({
      width: 100,
      height: 60,
    })
    expect(document.features[1]).toMatchObject({ distance: 8 })
    expect(document.features[2]).toMatchObject({
      placement: {
        kind: 'rectangular-edge-pattern',
        diameter: 6,
        edgeOffset: 8,
      },
    })
    expect(document.features[3]).toMatchObject({ radius: 4 })
    expect(document.commandLog).toHaveLength(1)
    expect(document.commandLog[0].commandCount).toBe(4)
  })

  it('rebuilds the edge-anchored hole pattern when width changes to 120 mm', () => {
    const created = applyCadTransaction(
      createCadDocument(),
      createMountingPlateTransaction('manual')
    )
    const sketch = plateSketch(created)
    const dimensions = sketchRectangleDimensions(sketch)
    if (!dimensions) throw new Error('Missing dimensions')
    const revised = applyCadTransaction(
      created,
      createCadTransaction('Set width to 120 mm', 'manual', [
        {
          type: 'sketch.constraint.update',
          sketchId: sketch.id,
          constraintId: dimensions.rectangle.widthConstraintId,
          value: 120,
        },
      ])
    )

    expect(sketchRectangleDimensions(plateSketch(revised))?.width).toBe(120)
    expect(revised.features[2]).toMatchObject({
      kind: 'hole',
      placement: { edgeOffset: 8 },
    })
    expect(cadDocumentFingerprint(revised)).not.toBe(
      cadDocumentFingerprint(created)
    )
  })

  it('uses the same transaction reducer for reviewed agent revisions', () => {
    const created = applyCadTransaction(
      createCadDocument(),
      createMountingPlateTransaction('manual')
    )
    const proposal = proposeCadAgentAction(
      created,
      'Make the plate 20 mm wider'
    )

    expect(proposal.error).toBeUndefined()
    expect(proposal.baseFingerprint).toBe(cadDocumentFingerprint(created))
    expect(proposal.transaction.commands).toHaveLength(1)
    expect(proposal.transaction.commands[0].type).toBe(
      'sketch.constraint.update'
    )
    expect(
      sketchRectangleDimensions(plateSketch(proposal.previewDocument!))?.width
    ).toBe(120)
    const executed = applyCadTransaction(created, proposal.transaction)
    expect(cadDocumentFingerprint(executed)).toBe(
      cadDocumentFingerprint(proposal.previewDocument!)
    )
  })

  it('treats mounting-plate wording as a revision when a model already exists', () => {
    const created = applyCadTransaction(
      createCadDocument(),
      createMountingPlateTransaction('manual')
    )
    const proposal = proposeCadAgentAction(
      created,
      'Set the mounting plate width to 120 mm'
    )

    expect(proposal.error).toBeUndefined()
    expect(proposal.transaction.commands).toHaveLength(1)
    expect(proposal.transaction.commands[0].type).toBe(
      'sketch.constraint.update'
    )
    expect(
      sketchRectangleDimensions(plateSketch(proposal.previewDocument!))?.width
    ).toBe(120)
    expect(proposal.previewDocument?.features).toHaveLength(4)
  })

  it('undoes and redoes exact document states', () => {
    const initial = createCadSession(createCadDocument())
    const created = executeCadTransaction(
      initial,
      createMountingPlateTransaction('manual')
    )
    const createdFingerprint = cadDocumentFingerprint(created.present)
    const sketch = plateSketch(created.present)
    const width = sketchRectangleDimensions(sketch)
    if (!width) throw new Error('Missing width')
    const revised = executeCadTransaction(
      created,
      createCadTransaction('Widen plate', 'agent', [
        {
          type: 'sketch.constraint.update',
          sketchId: sketch.id,
          constraintId: width.rectangle.widthConstraintId,
          value: 120,
        },
      ])
    )

    const undone = undoCadSession(revised)
    expect(cadDocumentFingerprint(undone.present)).toBe(createdFingerprint)
    const redone = redoCadSession(undone)
    expect(cadDocumentFingerprint(redone.present)).toBe(
      cadDocumentFingerprint(revised.present)
    )
    expect(redone.present).toEqual(revised.present)
  })

  it('persists typed commands and deterministically replays any history state', () => {
    const created = applyCadTransaction(
      createCadDocument('Replay plate', 1),
      createMountingPlateTransaction('agent', undefined, 2)
    )
    const sketch = plateSketch(created)
    const dimensions = sketchRectangleDimensions(sketch)
    if (!dimensions) throw new Error('Missing dimensions')
    const revised = applyCadTransaction(
      created,
      createCadTransaction(
        'Set width to 120 mm',
        'agent',
        [
          {
            type: 'sketch.constraint.update',
            sketchId: sketch.id,
            constraintId: dimensions.rectangle.widthConstraintId,
            value: 120,
          },
        ],
        3
      )
    )

    expect(revised.commandLog[0].commands).toHaveLength(4)
    expect(revised.commandLog[1].commands).toHaveLength(1)
    expect(replayCadHistory(revised)).toEqual(revised)
    const firstState = replayCadHistory(revised, revised.commandLog[0].id)
    expect(cadDocumentFingerprint(firstState)).toBe(
      revised.commandLog[0].afterFingerprint
    )
    expect(sketchRectangleDimensions(plateSketch(firstState))?.width).toBe(100)
  })

  it('autosaves the full feature and undo history across a new session', () => {
    const storage = new MemoryStorage()
    const initial = createCadSession(createCadDocument())
    const session = executeCadTransaction(
      initial,
      createMountingPlateTransaction('agent')
    )

    expect(saveCadSession(session, storage)).toEqual({
      fullHistorySaved: true,
    })
    const reopened = loadCadSession(storage)
    expect(reopened.present).toEqual(session.present)
    expect(reopened.past).toEqual(session.past)
    expect(reopened.present.commandLog[0].origin).toBe('agent')
  })

  it('round-trips a portable parametric document', () => {
    const document = applyCadTransaction(
      createCadDocument('Portable plate'),
      createMountingPlateTransaction('manual')
    )
    expect(decodeCadDocument(serializeCadDocument(document))).toEqual(document)
  })

  it('keeps a line length dimension synchronized with endpoint edits', () => {
    const sketch = createSketchFeature('Line sketch', 'manual')
    const line = createLineEntity(10)
    const created = applyCadTransaction(
      createCadDocument(),
      createCadTransaction('Create line', 'manual', [
        { type: 'feature.create', feature: sketch },
        {
          type: 'sketch.entity.create',
          sketchId: sketch.id,
          entity: line.entity,
          constraints: line.constraints,
        },
      ])
    )
    const revised = applyCadTransaction(
      created,
      createCadTransaction('Move line endpoint', 'manual', [
        {
          type: 'sketch.entity.update',
          sketchId: sketch.id,
          entityId: line.entity.id,
          changes: { end: { x: 3, y: 4 } },
        },
      ])
    )
    const revisedSketch = revised.features[0]
    expect(revisedSketch.kind).toBe('sketch')
    if (revisedSketch.kind !== 'sketch') return
    expect(revisedSketch.constraints[0].value).toBeCloseTo(
      Math.hypot(8, 4),
      8
    )
  })

  it('rejects unsupported imported feature and command variants', () => {
    const document = applyCadTransaction(
      createCadDocument(),
      createMountingPlateTransaction('manual')
    )
    const unknownFeature = JSON.parse(serializeCadDocument(document))
    unknownFeature.features[0].kind = 'opaque-kernel-mutation'
    expect(() => decodeCadDocument(unknownFeature)).toThrow(
      /kind is unsupported/
    )

    const tamperedHistory = JSON.parse(serializeCadDocument(document))
    tamperedHistory.commandLog[0].commands[0].type = 'geometry.replace'
    expect(() => decodeCadDocument(tamperedHistory)).toThrow(
      /type is unsupported/
    )
  })

  it('rejects an impossible fillet without corrupting the current document', () => {
    const document = applyCadTransaction(
      createCadDocument(),
      createMountingPlateTransaction('manual')
    )
    const before = cadDocumentFingerprint(document)
    const fillet = document.features.find(
      (feature) => feature.kind === 'fillet'
    )
    if (!fillet) throw new Error('Missing fillet')

    expect(() =>
      applyCadTransaction(
        document,
        createCadTransaction('Impossible fillet', 'manual', [
          {
            type: 'feature.update',
            featureId: fillet.id,
            changes: { kind: 'fillet', radius: 31 },
          },
        ])
      )
    ).toThrowError(CadCommandError)
    expect(cadDocumentFingerprint(document)).toBe(before)
    expect(fillet.radius).toBe(4)
  })
})
