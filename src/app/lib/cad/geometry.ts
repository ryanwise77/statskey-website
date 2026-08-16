import ManifoldModule, {
  type CrossSection,
  type Manifold,
  type ManifoldToplevel,
} from 'manifold-3d'
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url'
import {
  findCadFeature,
  sketchRectangleDimensions,
  validateCadDocument,
} from './document'
import type {
  CadBuildResult,
  CadDocument,
  CadFeature,
  CadFeatureBuildStatus,
  CadSketchFeature,
} from './types'

let modulePromise: Promise<ManifoldToplevel> | null = null

async function loadManifold(): Promise<ManifoldToplevel> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const runtimeProcess = (
        globalThis as {
          process?: { versions?: { node?: string }; type?: string }
        }
      ).process
      const runningInNode =
        Boolean(runtimeProcess?.versions?.node) &&
        runtimeProcess?.type !== 'renderer'
      const module = runningInNode
        ? await ManifoldModule()
        : await ManifoldModule({ locateFile: () => manifoldWasmUrl })
      module.setup()
      module.setMinCircularAngle(7.5)
      module.setMinCircularEdgeLength(0.35)
      return module
    })()
  }
  return modulePromise
}

function constraintValue(
  sketch: CadSketchFeature,
  constraintId: string
): number {
  const constraint = sketch.constraints.find((item) => item.id === constraintId)
  if (!constraint) {
    throw new Error(
      `Sketch “${sketch.name}” is missing a driving dimension (${constraintId}).`
    )
  }
  return constraint.value
}

function buildSketchCrossSection(
  module: ManifoldToplevel,
  sketch: CadSketchFeature
): CrossSection {
  const sections: CrossSection[] = []
  for (const entity of sketch.entities) {
    if (
      entity.kind === 'line' ||
      ('construction' in entity && entity.construction)
    ) {
      continue
    }
    if (entity.kind === 'rectangle') {
      const width = constraintValue(sketch, entity.widthConstraintId)
      const height = constraintValue(sketch, entity.heightConstraintId)
      sections.push(
        module.CrossSection.square([width, height], true).translate([
          entity.center.x,
          entity.center.y,
        ])
      )
    } else {
      const diameter = constraintValue(sketch, entity.diameterConstraintId)
      sections.push(
        module.CrossSection.circle(diameter / 2, 64).translate([
          entity.center.x,
          entity.center.y,
        ])
      )
    }
  }
  if (sections.length === 0) {
    throw new Error(
      `Sketch “${sketch.name}” has no closed rectangle or circle region to extrude. Lines remain editable but must form a supported closed profile first.`
    )
  }
  if (sections.length === 1) return sections[0]
  const result = module.CrossSection.union(sections)
  for (const section of sections) section.delete()
  return result
}

function roundedRectangle(
  module: ManifoldToplevel,
  sketch: CadSketchFeature,
  radius: number
): CrossSection {
  const dimensions = sketchRectangleDimensions(sketch)
  if (!dimensions) {
    throw new Error(
      `Sketch “${sketch.name}” needs a rectangular outline for corner fillets.`
    )
  }
  const innerWidth = dimensions.width - radius * 2
  const innerHeight = dimensions.height - radius * 2
  if (innerWidth <= 0 || innerHeight <= 0) {
    throw new Error(
      `The ${radius} mm fillet is too large for the plate outline.`
    )
  }
  const core = module.CrossSection.square([innerWidth, innerHeight], true)
  const rounded = core.offset(radius, 'Round', 2, 64)
  core.delete()
  return rounded.translate([
    dimensions.rectangle.center.x,
    dimensions.rectangle.center.y,
  ])
}

function chamferedRectangle(
  module: ManifoldToplevel,
  sketch: CadSketchFeature,
  distance: number
): CrossSection {
  const dimensions = sketchRectangleDimensions(sketch)
  if (!dimensions) {
    throw new Error(
      `Sketch “${sketch.name}” needs a rectangular outline for corner chamfers.`
    )
  }
  const halfWidth = dimensions.width / 2
  const halfHeight = dimensions.height / 2
  const x = dimensions.rectangle.center.x
  const y = dimensions.rectangle.center.y
  return new module.CrossSection([
    [
      [x - halfWidth + distance, y - halfHeight],
      [x + halfWidth - distance, y - halfHeight],
      [x + halfWidth, y - halfHeight + distance],
      [x + halfWidth, y + halfHeight - distance],
      [x + halfWidth - distance, y + halfHeight],
      [x - halfWidth + distance, y + halfHeight],
      [x - halfWidth, y + halfHeight - distance],
      [x - halfWidth, y - halfHeight + distance],
    ],
  ])
}

function assertHealthy(manifold: Manifold, feature: CadFeature): void {
  const status = manifold.status()
  if (status !== 'NoError') {
    throw new Error(
      `${feature.name} failed in the solid kernel (${status}). Adjust the selected dimensions or suppress this feature.`
    )
  }
  if (manifold.isEmpty()) {
    throw new Error(
      `${feature.name} produced an empty body. Check that the profiles overlap and the dimensions are possible.`
    )
  }
}

function replaceBody(
  bodies: Map<string, Manifold>,
  bodyId: string,
  replacement: Manifold,
  feature: CadFeature,
  consumedToolId?: string
): void {
  assertHealthy(replacement, feature)
  const prior = bodies.get(bodyId)
  const tool = consumedToolId ? bodies.get(consumedToolId) : undefined
  bodies.set(bodyId, replacement)
  if (consumedToolId) bodies.delete(consumedToolId)
  if (prior && prior !== replacement) prior.delete()
  if (tool && tool !== prior && tool !== replacement) tool.delete()
}

function markSkippedFeatures(
  features: CadFeature[],
  startIndex: number,
  statuses: CadFeatureBuildStatus[]
): void {
  for (const feature of features.slice(startIndex)) {
    statuses.push({
      featureId: feature.id,
      state: feature.suppressed ? 'suppressed' : 'error',
      message: feature.suppressed
        ? 'Suppressed'
        : 'Skipped because an earlier feature could not rebuild.',
    })
  }
}

export async function buildCadDocumentGeometry(
  document: CadDocument
): Promise<CadBuildResult> {
  try {
    validateCadDocument(document)
  } catch (error) {
    return {
      ok: false,
      documentRevision: document.revision,
      statuses: [],
      errors: [
        error instanceof Error
          ? error.message
          : 'The document model is invalid.',
      ],
    }
  }

  const module = await loadManifold()
  const sketches = new Map<string, CadSketchFeature>()
  const bodies = new Map<string, Manifold>()
  const statuses: CadFeatureBuildStatus[] = []
  const errors: string[] = []

  for (let index = 0; index < document.features.length; index += 1) {
    const feature = document.features[index]
    if (feature.suppressed) {
      statuses.push({
        featureId: feature.id,
        state: 'suppressed',
        message: 'Suppressed',
      })
      continue
    }
    try {
      switch (feature.kind) {
        case 'sketch':
          sketches.set(feature.id, feature)
          statuses.push({
            featureId: feature.id,
            state: 'ok',
            message: `${feature.entities.length} sketch entit${feature.entities.length === 1 ? 'y' : 'ies'} · ${feature.constraints.length} driving dimension${feature.constraints.length === 1 ? '' : 's'}`,
          })
          break
        case 'extrude': {
          const sketch = sketches.get(feature.profileId)
          if (!sketch) {
            throw new Error(
              `${feature.name} cannot rebuild because its sketch is suppressed or unavailable.`
            )
          }
          const section = buildSketchCrossSection(module, sketch)
          const body = section.extrude(feature.distance)
          section.delete()
          assertHealthy(body, feature)
          bodies.set(feature.bodyId, body)
          statuses.push({
            featureId: feature.id,
            state: 'ok',
            message: `${feature.distance} mm new solid`,
          })
          break
        }
        case 'hole': {
          const target = bodies.get(feature.bodyId)
          const sketch = sketches.get(feature.profileId)
          if (!target || !sketch) {
            throw new Error(
              `${feature.name} cannot find its target body or driving sketch.`
            )
          }
          const bounds = target.boundingBox()
          const depth = bounds.max[2] - bounds.min[2] + 2
          const radius = feature.placement.diameter / 2
          let centers: Array<{ x: number; y: number }>
          if (feature.placement.kind === 'explicit') {
            centers = feature.placement.centers
          } else {
            const dimensions = sketchRectangleDimensions(sketch)
            if (!dimensions) {
              throw new Error(
                `${feature.name} needs a rectangular profile for its edge-offset pattern.`
              )
            }
            const x = dimensions.width / 2 - feature.placement.edgeOffset
            const y = dimensions.height / 2 - feature.placement.edgeOffset
            const center = dimensions.rectangle.center
            centers = [
              { x: center.x - x, y: center.y - y },
              { x: center.x + x, y: center.y - y },
              { x: center.x + x, y: center.y + y },
              { x: center.x - x, y: center.y + y },
            ]
          }
          const cutters = centers.map((center) =>
            module.Manifold.cylinder(depth, radius, radius, 64).translate([
              center.x,
              center.y,
              bounds.min[2] - 1,
            ])
          )
          const cutter =
            cutters.length === 1
              ? cutters[0]
              : module.Manifold.union(cutters)
          if (cutters.length > 1) {
            for (const item of cutters) item.delete()
          }
          const result = target.subtract(cutter)
          assertHealthy(result, feature)
          cutter.delete()
          replaceBody(bodies, feature.bodyId, result, feature)
          statuses.push({
            featureId: feature.id,
            state: 'ok',
            message: `${centers.length} × Ø${feature.placement.diameter} mm · through all`,
          })
          break
        }
        case 'fillet':
        case 'chamfer': {
          const target = bodies.get(feature.bodyId)
          const sketch = sketches.get(feature.profileId)
          if (!target || !sketch) {
            throw new Error(
              `${feature.name} cannot find its target body or driving sketch.`
            )
          }
          const bounds = target.boundingBox()
          const section =
            feature.kind === 'fillet'
              ? roundedRectangle(module, sketch, feature.radius)
              : chamferedRectangle(module, sketch, feature.distance)
          const envelope = section
            .extrude(bounds.max[2] - bounds.min[2])
            .translate([0, 0, bounds.min[2]])
          section.delete()
          const result = target.intersect(envelope)
          assertHealthy(result, feature)
          envelope.delete()
          replaceBody(bodies, feature.bodyId, result, feature)
          statuses.push({
            featureId: feature.id,
            state: 'ok',
            message:
              feature.kind === 'fillet'
                ? `R${feature.radius} mm · 4 outer vertical edges`
                : `${feature.distance} mm · 4 outer vertical edges`,
          })
          break
        }
        case 'boolean': {
          const target = bodies.get(feature.bodyId)
          const tool = bodies.get(feature.toolBodyId)
          if (!target || !tool) {
            throw new Error(
              `${feature.name} cannot find both selected solid bodies.`
            )
          }
          const result =
            feature.operation === 'union'
              ? target.add(tool)
              : target.subtract(tool)
          replaceBody(
            bodies,
            feature.bodyId,
            result,
            feature,
            feature.toolBodyId
          )
          statuses.push({
            featureId: feature.id,
            state: 'ok',
            message: `${feature.operation} · 2 bodies → 1 body`,
          })
          break
        }
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `${feature.name} failed.`
      errors.push(message)
      statuses.push({
        featureId: feature.id,
        state: 'error',
        message,
      })
      markSkippedFeatures(document.features, index + 1, statuses)
      break
    }
  }

  if (bodies.size === 0) {
    return {
      ok: errors.length === 0,
      documentRevision: document.revision,
      statuses,
      errors,
    }
  }

  try {
    const bodyList = [...bodies.values()]
    const syntheticFeature: CadFeature =
      document.features.find((feature) => feature.kind === 'extrude') ??
      ({
        id: 'combined',
        kind: 'sketch',
        name: 'Combined model',
        origin: 'manual',
        suppressed: false,
        plane: 'XY',
        entities: [],
        constraints: [],
      } satisfies CadSketchFeature)
    const positions: number[] = []
    const indices: number[] = []
    const components: Array<{ indexStart: number; indexCount: number }> = []
    const min: [number, number, number] = [
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]
    const max: [number, number, number] = [
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]
    let volume = 0
    let surfaceArea = 0
    for (const body of bodyList) {
      assertHealthy(body, syntheticFeature)
      const bodyMesh = body.getMesh()
      const vertexOffset = positions.length / 3
      const indexStart = indices.length
      for (let vertex = 0; vertex < bodyMesh.numVert; vertex += 1) {
        const source = vertex * bodyMesh.numProp
        positions.push(
          bodyMesh.vertProperties[source],
          bodyMesh.vertProperties[source + 1],
          bodyMesh.vertProperties[source + 2]
        )
      }
      for (const index of bodyMesh.triVerts) {
        indices.push(index + vertexOffset)
      }
      components.push({
        indexStart,
        indexCount: indices.length - indexStart,
      })
      const bounds = body.boundingBox()
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], bounds.min[axis])
        max[axis] = Math.max(max[axis], bounds.max[axis])
      }
      volume += body.volume()
      surfaceArea += body.surfaceArea()
    }
    const packedPositions = Float32Array.from(positions)
    const packedIndices = Uint32Array.from(indices)
    return {
      ok: errors.length === 0,
      documentRevision: document.revision,
      mesh: {
        positions: packedPositions,
        indices: packedIndices,
        components,
      },
      metrics: {
        bounds: {
          min,
          max,
          size: [
            max[0] - min[0],
            max[1] - min[1],
            max[2] - min[2],
          ],
        },
        volume,
        surfaceArea,
        triangleCount: packedIndices.length / 3,
        bodyCount: bodyList.length,
      },
      statuses,
      errors,
    }
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : 'The final mesh could not rebuild.'
    )
    return {
      ok: false,
      documentRevision: document.revision,
      statuses,
      errors,
    }
  } finally {
    const uniqueBodies = new Set(bodies.values())
    for (const body of uniqueBodies) body.delete()
  }
}

export function mountingPlateExpectedBounds(
  document: CadDocument
): [number, number, number] | null {
  const extrude = document.features.find(
    (feature) => feature.kind === 'extrude' && !feature.suppressed
  )
  if (!extrude || extrude.kind !== 'extrude') return null
  const sketch = findCadFeature(document, extrude.profileId, 'sketch')
  if (!sketch || sketch.kind !== 'sketch') return null
  const dimensions = sketchRectangleDimensions(sketch)
  return dimensions
    ? [dimensions.width, dimensions.height, extrude.distance]
    : null
}
