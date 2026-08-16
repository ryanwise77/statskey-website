import { describe, expect, it } from 'vitest'
import {
  applyCadTransaction,
  cadId,
  createCadDocument,
  createCadTransaction,
  createMountingPlateTransaction,
  createRectangleEntity,
  createSketchFeature,
  sketchRectangleDimensions,
} from './document'
import {
  exportBinaryStl,
  exportFacetedStep,
  validateBinaryStl,
  validateFacetedStep,
} from './exports'
import { buildCadDocumentGeometry } from './geometry'
import type { CadExtrudeFeature, CadSketchFeature } from './types'

function acceptancePlate() {
  return applyCadTransaction(
    createCadDocument('Acceptance plate', 1),
    createMountingPlateTransaction('manual', undefined, 2)
  )
}

describe('CAD solid rebuild and interoperability', () => {
  it('builds the acceptance plate with expected bounds and four through-holes', async () => {
    const result = await buildCadDocumentGeometry(acceptancePlate())

    expect(result.ok, result.errors.join('\n')).toBe(true)
    expect(result.metrics?.bounds.size[0]).toBeCloseTo(100, 3)
    expect(result.metrics?.bounds.size[1]).toBeCloseTo(60, 3)
    expect(result.metrics?.bounds.size[2]).toBeCloseTo(8, 3)
    expect(result.metrics?.bodyCount).toBe(1)
    expect(result.metrics?.triangleCount).toBeGreaterThan(100)
    expect(result.metrics?.volume).toBeGreaterThan(46_900)
    expect(result.metrics?.volume).toBeLessThan(47_100)
    expect(result.statuses.map((status) => status.state)).toEqual([
      'ok',
      'ok',
      'ok',
      'ok',
    ])
  })

  it('rebuilds deterministically after the driving width changes', async () => {
    const initial = acceptancePlate()
    const sketch = initial.features.find(
      (feature): feature is CadSketchFeature => feature.kind === 'sketch'
    )
    if (!sketch) throw new Error('Missing sketch')
    const dimensions = sketchRectangleDimensions(sketch)
    if (!dimensions) throw new Error('Missing dimensions')
    const revised = applyCadTransaction(
      initial,
      createCadTransaction('Set width to 120 mm', 'agent', [
        {
          type: 'sketch.constraint.update',
          sketchId: sketch.id,
          constraintId: dimensions.rectangle.widthConstraintId,
          value: 120,
        },
      ])
    )

    const first = await buildCadDocumentGeometry(revised)
    const second = await buildCadDocumentGeometry(revised)
    expect(first.ok, first.errors.join('\n')).toBe(true)
    expect(first.metrics?.bounds.size).toEqual([120, 60, 8])
    expect(second.metrics).toEqual(first.metrics)
    expect([...second.mesh!.positions]).toEqual([...first.mesh!.positions])
    expect([...second.mesh!.indices]).toEqual([...first.mesh!.indices])
  })

  it('exports and independently validates binary STL dimensions', async () => {
    const result = await buildCadDocumentGeometry(acceptancePlate())
    if (!result.mesh) throw new Error(result.errors.join('\n'))
    const stl = exportBinaryStl(result.mesh, 'Acceptance plate')
    const validation = validateBinaryStl(stl, [100, 60, 8])

    expect(validation.valid, validation.errors.join('\n')).toBe(true)
    expect(validation.triangleCount).toBe(result.metrics?.triangleCount)
    expect(validation.bounds?.size).toEqual([100, 60, 8])
  })

  it('exports a closed faceted STEP B-Rep with valid references and dimensions', async () => {
    const result = await buildCadDocumentGeometry(acceptancePlate())
    if (!result.mesh) throw new Error(result.errors.join('\n'))
    const step = exportFacetedStep(
      result.mesh,
      'Acceptance plate',
      new Date('2026-08-15T12:00:00Z')
    )
    const validation = validateFacetedStep(step, [100, 60, 8])

    expect(validation.valid, validation.errors.join('\n')).toBe(true)
    expect(step).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'))")
    expect(step).toContain('FACETED_BREP')
    expect(step).toContain('CLOSED_SHELL')
    expect(step).toContain('FACE_SURFACE')
    expect(step).toContain('PLANE')
    expect(step).not.toMatch(/=\s*FACE\(/)
    expect(validation.triangleCount).toBe(result.metrics?.triangleCount)
  })

  it('preserves separate solid bodies until an explicit Boolean feature', async () => {
    const firstSketch = createSketchFeature('First sketch', 'manual')
    const firstRectangle = createRectangleEntity(10, 10)
    firstRectangle.entity.center = { x: -10, y: 0 }
    firstSketch.entities = [firstRectangle.entity]
    firstSketch.constraints = firstRectangle.constraints
    const secondSketch = createSketchFeature('Second sketch', 'manual')
    const secondRectangle = createRectangleEntity(10, 10)
    secondRectangle.entity.center = { x: 10, y: 0 }
    secondSketch.entities = [secondRectangle.entity]
    secondSketch.constraints = secondRectangle.constraints
    const firstExtrude: CadExtrudeFeature = {
      id: cadId('feature'),
      kind: 'extrude',
      name: 'First body',
      origin: 'manual',
      suppressed: false,
      profileId: firstSketch.id,
      bodyId: cadId('body'),
      distance: 5,
      direction: 'normal',
      operation: 'new',
    }
    const secondExtrude: CadExtrudeFeature = {
      ...firstExtrude,
      id: cadId('feature'),
      name: 'Second body',
      profileId: secondSketch.id,
      bodyId: cadId('body'),
    }
    const document = applyCadTransaction(
      createCadDocument('Two bodies'),
      createCadTransaction('Create two bodies', 'manual', [
        { type: 'feature.create', feature: firstSketch },
        { type: 'feature.create', feature: firstExtrude },
        { type: 'feature.create', feature: secondSketch },
        { type: 'feature.create', feature: secondExtrude },
      ])
    )
    const result = await buildCadDocumentGeometry(document)

    expect(result.ok, result.errors.join('\n')).toBe(true)
    expect(result.metrics?.bodyCount).toBe(2)
    expect(result.metrics?.bounds.size).toEqual([30, 10, 5])
    expect(result.mesh?.components).toHaveLength(2)
    const step = exportFacetedStep(result.mesh!, document.name)
    expect(step.match(/FACETED_BREP\(/g)).toHaveLength(2)
    const validation = validateFacetedStep(step, [30, 10, 5])
    expect(validation.valid, validation.errors.join('\n')).toBe(true)
  })
})
