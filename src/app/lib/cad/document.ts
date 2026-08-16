import {
  CAD_DOCUMENT_SCHEMA_VERSION,
  type CadCircleEntity,
  type CadCommand,
  type CadCommandRecord,
  type CadDocument,
  type CadExtrudeFeature,
  type CadFeature,
  type CadFeatureChanges,
  type CadFeatureOrigin,
  type CadFilletFeature,
  type CadHoleFeature,
  type CadId,
  type CadLineEntity,
  type CadRectangleEntity,
  type CadSketchConstraint,
  type CadSketchEntity,
  type CadSketchFeature,
  type CadTransaction,
} from './types'

const MAX_COMMAND_LOG = 256

export class CadCommandError extends Error {
  readonly code: string
  readonly commandIndex?: number

  constructor(code: string, message: string, commandIndex?: number) {
    super(message)
    this.name = 'CadCommandError'
    this.code = code
    this.commandIndex = commandIndex
  }
}

export function cadId(prefix: string): CadId {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `${prefix}:${suffix}`
}

export function createCadDocument(
  name = 'Untitled model',
  now = Date.now()
): CadDocument {
  return {
    schemaVersion: CAD_DOCUMENT_SCHEMA_VERSION,
    id: cadId('document'),
    name,
    units: 'mm',
    revision: 0,
    createdAt: now,
    updatedAt: now,
    features: [],
    historyBase: {
      name,
      revision: 0,
      updatedAt: now,
      features: [],
    },
    commandLog: [],
  }
}

export function createCadTransaction(
  label: string,
  origin: CadFeatureOrigin,
  commands: CadCommand[],
  issuedAt = Date.now()
): CadTransaction {
  return {
    id: cadId('transaction'),
    label,
    origin,
    issuedAt,
    commands,
  }
}

function cloneDocument(document: CadDocument): CadDocument {
  return typeof structuredClone === 'function'
    ? structuredClone(document)
    : (JSON.parse(JSON.stringify(document)) as CadDocument)
}

export function cadDocumentFingerprint(document: CadDocument): string {
  const documentState = JSON.stringify({
    schemaVersion: document.schemaVersion,
    name: document.name,
    units: document.units,
    features: document.features,
  })
  let hash = 0x811c9dc5
  for (let index = 0; index < documentState.length; index += 1) {
    hash ^= documentState.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function documentFromHistoryBase(document: CadDocument): CadDocument {
  return {
    schemaVersion: document.schemaVersion,
    id: document.id,
    name: document.historyBase.name,
    units: document.units,
    revision: document.historyBase.revision,
    createdAt: document.createdAt,
    updatedAt: document.historyBase.updatedAt,
    features: structuredClone(document.historyBase.features),
    historyBase: structuredClone(document.historyBase),
    commandLog: [],
  }
}

function transactionFromRecord(record: CadCommandRecord): CadTransaction {
  return {
    id: record.id,
    label: record.label,
    origin: record.origin,
    issuedAt: record.issuedAt,
    commands: structuredClone(record.commands),
  }
}

export function replayCadHistory(
  document: CadDocument,
  throughRecordId?: CadId
): CadDocument {
  let replayed = documentFromHistoryBase(document)
  validateCadDocument(replayed)
  let found = throughRecordId == null
  for (const record of document.commandLog) {
    if (record.commands.length !== record.commandCount) {
      throw new CadCommandError(
        'history-not-replayable',
        `“${record.label}” does not contain its complete typed command payload.`
      )
    }
    if (cadDocumentFingerprint(replayed) !== record.beforeFingerprint) {
      throw new CadCommandError(
        'history-fingerprint-mismatch',
        `“${record.label}” cannot replay because its starting state no longer matches the recorded fingerprint.`
      )
    }
    replayed = applyCadTransaction(replayed, transactionFromRecord(record))
    if (cadDocumentFingerprint(replayed) !== record.afterFingerprint) {
      throw new CadCommandError(
        'history-fingerprint-mismatch',
        `“${record.label}” replayed to a different state than the recorded result.`
      )
    }
    if (record.id === throughRecordId) {
      found = true
      break
    }
  }
  if (!found) {
    throw new CadCommandError(
      'history-record-not-found',
      'The selected history record is no longer available.'
    )
  }
  return replayed
}

export function findCadFeature<T extends CadFeature['kind']>(
  document: CadDocument,
  featureId: CadId,
  kind?: T
): Extract<CadFeature, { kind: T }> | CadFeature | undefined {
  const feature = document.features.find((item) => item.id === featureId)
  if (!feature || (kind && feature.kind !== kind)) return undefined
  return feature
}

export function findSketchConstraint(
  document: CadDocument,
  constraintId: CadId
): CadSketchConstraint | undefined {
  for (const feature of document.features) {
    if (feature.kind !== 'sketch') continue
    const constraint = feature.constraints.find(
      (item) => item.id === constraintId
    )
    if (constraint) return constraint
  }
  return undefined
}

export function sketchRectangleDimensions(
  sketch: CadSketchFeature
): {
  rectangle: CadRectangleEntity
  width: number
  height: number
} | null {
  const rectangle = sketch.entities.find(
    (entity): entity is CadRectangleEntity => entity.kind === 'rectangle'
  )
  if (!rectangle) return null
  const width = sketch.constraints.find(
    (constraint) => constraint.id === rectangle.widthConstraintId
  )?.value
  const height = sketch.constraints.find(
    (constraint) => constraint.id === rectangle.heightConstraintId
  )?.value
  if (width == null || height == null) return null
  return { rectangle, width, height }
}

function featureDependencies(feature: CadFeature): CadId[] {
  switch (feature.kind) {
    case 'extrude':
      return [feature.profileId]
    case 'hole':
    case 'fillet':
    case 'chamfer':
      return [feature.profileId]
    case 'boolean':
    case 'sketch':
      return []
  }
}

function bodyCreatedBy(feature: CadFeature): CadId | null {
  return feature.kind === 'extrude' ? feature.bodyId : null
}

function bodyInputs(feature: CadFeature): CadId[] {
  switch (feature.kind) {
    case 'hole':
    case 'fillet':
    case 'chamfer':
      return [feature.bodyId]
    case 'boolean':
      return [feature.bodyId, feature.toolBodyId]
    case 'sketch':
    case 'extrude':
      return []
  }
}

function dependentFeatureIds(
  document: CadDocument,
  rootFeatureId: CadId
): Set<CadId> {
  const removed = new Set<CadId>([rootFeatureId])
  const removedBodies = new Set<CadId>()
  let changed = true
  while (changed) {
    changed = false
    for (const feature of document.features) {
      if (removed.has(feature.id)) {
        const bodyId = bodyCreatedBy(feature)
        if (bodyId && !removedBodies.has(bodyId)) {
          removedBodies.add(bodyId)
          changed = true
        }
        continue
      }
      if (
        featureDependencies(feature).some((id) => removed.has(id)) ||
        bodyInputs(feature).some((id) => removedBodies.has(id))
      ) {
        removed.add(feature.id)
        const bodyId = bodyCreatedBy(feature)
        if (bodyId) removedBodies.add(bodyId)
        changed = true
      }
    }
  }
  return removed
}

function featureIndex(document: CadDocument, featureId: CadId): number {
  return document.features.findIndex((feature) => feature.id === featureId)
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new CadCommandError(
      'invalid-dimension',
      `${label} must be a finite value greater than 0 mm.`
    )
  }
}

function applyFeatureChanges(
  feature: CadFeature,
  changes: CadFeatureChanges
): CadFeature {
  if (feature.kind !== changes.kind) {
    throw new CadCommandError(
      'feature-kind-mismatch',
      `Cannot apply ${changes.kind} parameters to the ${feature.kind} feature “${feature.name}”.`
    )
  }
  switch (feature.kind) {
    case 'sketch':
      if (changes.kind !== 'sketch') return feature
      return {
        ...feature,
        name: changes.name ?? feature.name,
        plane: changes.plane ?? feature.plane,
      }
    case 'extrude':
      if (changes.kind !== 'extrude') return feature
      if (changes.distance != null) {
        assertFinitePositive(changes.distance, 'Extrude distance')
      }
      return { ...feature, ...changes }
    case 'hole': {
      if (changes.kind !== 'hole') return feature
      const diameter = changes.diameter ?? feature.placement.diameter
      assertFinitePositive(diameter, 'Hole diameter')
      if (changes.edgeOffset != null) {
        assertFinitePositive(changes.edgeOffset, 'Hole edge offset')
        if (feature.placement.kind !== 'rectangular-edge-pattern') {
          throw new CadCommandError(
            'unsupported-hole-update',
            'Edge offset applies only to a rectangular edge pattern.'
          )
        }
      }
      return {
        ...feature,
        name: changes.name ?? feature.name,
        placement:
          feature.placement.kind === 'rectangular-edge-pattern'
            ? {
                ...feature.placement,
                diameter,
                edgeOffset:
                  changes.edgeOffset ?? feature.placement.edgeOffset,
              }
            : { ...feature.placement, diameter },
      }
    }
    case 'fillet':
      if (changes.kind !== 'fillet') return feature
      if (changes.radius != null) {
        assertFinitePositive(changes.radius, 'Fillet radius')
      }
      return { ...feature, ...changes }
    case 'chamfer':
      if (changes.kind !== 'chamfer') return feature
      if (changes.distance != null) {
        assertFinitePositive(changes.distance, 'Chamfer distance')
      }
      return { ...feature, ...changes }
    case 'boolean':
      return changes.kind === 'boolean' ? { ...feature, ...changes } : feature
  }
}

function applyCommand(document: CadDocument, command: CadCommand): void {
  switch (command.type) {
    case 'document.rename':
      if (!command.name.trim()) {
        throw new CadCommandError(
          'invalid-name',
          'The model name cannot be empty.'
        )
      }
      document.name = command.name.trim().slice(0, 160)
      return
    case 'feature.create':
      if (featureIndex(document, command.feature.id) >= 0) {
        throw new CadCommandError(
          'duplicate-feature-id',
          `A feature with ID ${command.feature.id} already exists.`
        )
      }
      document.features.push(structuredClone(command.feature))
      return
    case 'feature.update': {
      const index = featureIndex(document, command.featureId)
      if (index < 0) {
        throw new CadCommandError(
          'feature-not-found',
          `The selected feature no longer exists.`
        )
      }
      document.features[index] = applyFeatureChanges(
        document.features[index],
        command.changes
      )
      return
    }
    case 'feature.suppress': {
      const feature = document.features.find(
        (item) => item.id === command.featureId
      )
      if (!feature) {
        throw new CadCommandError(
          'feature-not-found',
          'The selected feature no longer exists.'
        )
      }
      feature.suppressed = command.suppressed
      return
    }
    case 'feature.delete': {
      const index = featureIndex(document, command.featureId)
      if (index < 0) {
        throw new CadCommandError(
          'feature-not-found',
          'The selected feature no longer exists.'
        )
      }
      const dependents = dependentFeatureIds(document, command.featureId)
      if (dependents.size > 1 && !command.cascade) {
        throw new CadCommandError(
          'feature-has-dependents',
          `“${document.features[index].name}” has ${dependents.size - 1} dependent feature${dependents.size === 2 ? '' : 's'}. Delete with dependents or suppress it instead.`
        )
      }
      document.features = document.features.filter(
        (feature) => !dependents.has(feature.id)
      )
      return
    }
    case 'sketch.entity.create': {
      const sketch = findCadFeature(document, command.sketchId, 'sketch')
      if (!sketch || sketch.kind !== 'sketch') {
        throw new CadCommandError(
          'sketch-not-found',
          'Create a sketch before adding sketch geometry.'
        )
      }
      if (sketch.entities.some((entity) => entity.id === command.entity.id)) {
        throw new CadCommandError(
          'duplicate-entity-id',
          `A sketch entity with ID ${command.entity.id} already exists.`
        )
      }
      sketch.entities.push(structuredClone(command.entity))
      sketch.constraints.push(...structuredClone(command.constraints))
      return
    }
    case 'sketch.entity.update': {
      const sketch = findCadFeature(document, command.sketchId, 'sketch')
      if (!sketch || sketch.kind !== 'sketch') {
        throw new CadCommandError(
          'sketch-not-found',
          'The selected sketch no longer exists.'
        )
      }
      const index = sketch.entities.findIndex(
        (entity) => entity.id === command.entityId
      )
      if (index < 0) {
        throw new CadCommandError(
          'entity-not-found',
          'The selected sketch entity no longer exists.'
        )
      }
      const updated = {
        ...sketch.entities[index],
        ...command.changes,
      } as CadSketchEntity
      sketch.entities[index] = updated
      if (
        updated.kind === 'line' &&
        (command.changes.start != null || command.changes.end != null)
      ) {
        const length = Math.hypot(
          updated.end.x - updated.start.x,
          updated.end.y - updated.start.y
        )
        assertFinitePositive(length, 'Line length')
        const constraint = sketch.constraints.find(
          (item) =>
            item.entityId === updated.id && item.kind === 'length'
        )
        if (constraint) constraint.value = length
      }
      return
    }
    case 'sketch.constraint.update': {
      const sketch = findCadFeature(document, command.sketchId, 'sketch')
      if (!sketch || sketch.kind !== 'sketch') {
        throw new CadCommandError(
          'sketch-not-found',
          'The selected sketch no longer exists.'
        )
      }
      assertFinitePositive(command.value, 'Constraint')
      const constraint = sketch.constraints.find(
        (item) => item.id === command.constraintId
      )
      if (!constraint) {
        throw new CadCommandError(
          'constraint-not-found',
          'The selected dimension no longer exists.'
        )
      }
      constraint.value = command.value
      if (constraint.kind === 'length') {
        const line = sketch.entities.find(
          (entity): entity is CadLineEntity =>
            entity.id === constraint.entityId && entity.kind === 'line'
        )
        if (line) {
          const dx = line.end.x - line.start.x
          const dy = line.end.y - line.start.y
          const priorLength = Math.hypot(dx, dy)
          const unitX = priorLength > 1e-9 ? dx / priorLength : 1
          const unitY = priorLength > 1e-9 ? dy / priorLength : 0
          line.end = {
            x: line.start.x + unitX * command.value,
            y: line.start.y + unitY * command.value,
          }
        }
      }
      return
    }
    default:
      throw new CadCommandError(
        'unsupported-command',
        `Unsupported CAD command ${String((command as { type?: unknown }).type)}.`
      )
  }
}

function validateSketch(sketch: CadSketchFeature): void {
  const entityIds = new Set(sketch.entities.map((entity) => entity.id))
  if (entityIds.size !== sketch.entities.length) {
    throw new CadCommandError(
      'duplicate-entity-id',
      `Sketch “${sketch.name}” contains duplicate entity IDs.`
    )
  }
  const constraintIds = new Set<string>()
  for (const constraint of sketch.constraints) {
    if (constraintIds.has(constraint.id)) {
      throw new CadCommandError(
        'duplicate-constraint-id',
        `Sketch “${sketch.name}” contains duplicate constraint IDs.`
      )
    }
    constraintIds.add(constraint.id)
    if (!entityIds.has(constraint.entityId)) {
      throw new CadCommandError(
        'invalid-constraint-reference',
        `Dimension “${constraint.label}” references missing sketch geometry.`
      )
    }
    assertFinitePositive(constraint.value, constraint.label)
  }
  for (const entity of sketch.entities) {
    if (entity.kind === 'rectangle') {
      if (
        !constraintIds.has(entity.widthConstraintId) ||
        !constraintIds.has(entity.heightConstraintId)
      ) {
        throw new CadCommandError(
          'missing-dimension',
          `Rectangle “${entity.name}” needs editable width and height dimensions.`
        )
      }
    }
    if (
      entity.kind === 'circle' &&
      !constraintIds.has(entity.diameterConstraintId)
    ) {
      throw new CadCommandError(
        'missing-dimension',
        `Circle “${entity.name}” needs an editable diameter dimension.`
      )
    }
  }
}

export function validateCadDocument(document: CadDocument): void {
  if (document.schemaVersion !== CAD_DOCUMENT_SCHEMA_VERSION) {
    throw new CadCommandError(
      'unsupported-schema',
      `This model uses unsupported schema version ${String(document.schemaVersion)}.`
    )
  }
  if (document.units !== 'mm') {
    throw new CadCommandError(
      'unsupported-units',
      'This CAD foundation currently requires millimeter document units.'
    )
  }
  const featureIds = new Set<CadId>()
  const availableBodies = new Set<CadId>()
  const booleanProcessedBodies = new Set<CadId>()
  for (const feature of document.features) {
    if (featureIds.has(feature.id)) {
      throw new CadCommandError(
        'duplicate-feature-id',
        `Duplicate feature ID ${feature.id} would make rebuilds ambiguous.`
      )
    }
    featureIds.add(feature.id)
    if (!feature.name.trim()) {
      throw new CadCommandError(
        'invalid-feature-name',
        'Every feature needs a name.'
      )
    }
    if (feature.kind === 'sketch') validateSketch(feature)
    if (feature.kind === 'extrude') {
      assertFinitePositive(feature.distance, `${feature.name} distance`)
      const profile = findCadFeature(document, feature.profileId, 'sketch')
      if (!profile || featureIndex(document, profile.id) >= featureIndex(document, feature.id)) {
        throw new CadCommandError(
          'invalid-profile-reference',
          `Extrude “${feature.name}” needs an earlier sketch profile.`
        )
      }
      if (availableBodies.has(feature.bodyId)) {
        throw new CadCommandError(
          'duplicate-body-id',
          `Extrude “${feature.name}” reuses an existing body ID.`
        )
      }
      availableBodies.add(feature.bodyId)
    }
    if (
      feature.kind === 'hole' ||
      feature.kind === 'fillet' ||
      feature.kind === 'chamfer'
    ) {
      if (!availableBodies.has(feature.bodyId)) {
        throw new CadCommandError(
          'body-not-found',
          `Feature “${feature.name}” needs an earlier solid body.`
        )
      }
      const profile = findCadFeature(document, feature.profileId, 'sketch')
      if (!profile || profile.kind !== 'sketch') {
        throw new CadCommandError(
          'profile-not-found',
          `Feature “${feature.name}” cannot find its driving sketch.`
        )
      }
      const dimensions = sketchRectangleDimensions(profile)
      if (!dimensions) {
        throw new CadCommandError(
          'rectangular-profile-required',
          `Feature “${feature.name}” needs a rectangular driving profile.`
        )
      }
      const shorterSide = Math.min(dimensions.width, dimensions.height)
      if (
        (feature.kind === 'fillet' || feature.kind === 'chamfer') &&
        booleanProcessedBodies.has(feature.bodyId)
      ) {
        throw new CadCommandError(
          'unsupported-edge-treatment-order',
          `Move “${feature.name}” before the Boolean feature. Edge treatments after a Boolean are not yet supported because they could trim unrelated unioned geometry.`
        )
      }
      if (feature.kind === 'hole') {
        assertFinitePositive(feature.placement.diameter, 'Hole diameter')
        if (feature.placement.kind === 'rectangular-edge-pattern') {
          const { diameter, edgeOffset } = feature.placement
          assertFinitePositive(edgeOffset, 'Hole edge offset')
          if (edgeOffset < diameter / 2) {
            throw new CadCommandError(
              'hole-breaks-edge',
              `The ${diameter} mm holes need an edge offset of at least ${diameter / 2} mm so they do not break through the plate edge.`
            )
          }
          if (
            dimensions.width - edgeOffset * 2 < diameter ||
            dimensions.height - edgeOffset * 2 < diameter
          ) {
            throw new CadCommandError(
              'hole-pattern-overlap',
              `The four ${diameter} mm holes overlap at a ${edgeOffset} mm edge offset. Reduce the offset or hole diameter.`
            )
          }
        } else if (feature.placement.centers.length === 0) {
          throw new CadCommandError(
            'empty-hole-pattern',
            'Add at least one hole center.'
          )
        }
      } else if (feature.kind === 'fillet') {
        assertFinitePositive(feature.radius, 'Fillet radius')
        if (feature.radius * 2 >= shorterSide) {
          throw new CadCommandError(
            'fillet-too-large',
            `The ${feature.radius} mm fillet is too large for a ${dimensions.width} × ${dimensions.height} mm profile. Use less than ${shorterSide / 2} mm.`
          )
        }
      } else {
        assertFinitePositive(feature.distance, 'Chamfer distance')
        if (feature.distance * 2 >= shorterSide) {
          throw new CadCommandError(
            'chamfer-too-large',
            `The ${feature.distance} mm chamfer is too large for a ${dimensions.width} × ${dimensions.height} mm profile.`
          )
        }
      }
    }
    if (feature.kind === 'boolean') {
      if (!availableBodies.has(feature.bodyId)) {
        throw new CadCommandError(
          'boolean-target-not-found',
          `Boolean “${feature.name}” cannot find its target body.`
        )
      }
      if (!availableBodies.has(feature.toolBodyId)) {
        throw new CadCommandError(
          'boolean-tool-not-found',
          `Boolean “${feature.name}” cannot find its tool body.`
        )
      }
      if (feature.bodyId === feature.toolBodyId) {
        throw new CadCommandError(
          'boolean-self-reference',
          'A boolean target and tool must be different bodies.'
        )
      }
      if (!feature.suppressed) {
        availableBodies.delete(feature.toolBodyId)
        booleanProcessedBodies.add(feature.bodyId)
      }
    }
  }
}

export function applyCadTransaction(
  current: CadDocument,
  transaction: CadTransaction
): CadDocument {
  if (transaction.commands.length === 0) {
    throw new CadCommandError(
      'empty-transaction',
      'This operation does not contain any model changes.'
    )
  }
  const next = cloneDocument(current)
  const beforeFingerprint = cadDocumentFingerprint(current)
  for (let index = 0; index < transaction.commands.length; index += 1) {
    try {
      applyCommand(next, transaction.commands[index])
    } catch (error) {
      if (error instanceof CadCommandError) {
        throw new CadCommandError(error.code, error.message, index)
      }
      throw error
    }
  }
  validateCadDocument(next)
  next.revision = current.revision + 1
  next.updatedAt = transaction.issuedAt
  const afterFingerprint = cadDocumentFingerprint(next)
  const record: CadCommandRecord = {
    id: transaction.id,
    label: transaction.label,
    origin: transaction.origin,
    issuedAt: transaction.issuedAt,
    commandCount: transaction.commands.length,
    commands: structuredClone(transaction.commands),
    beforeFingerprint,
    afterFingerprint,
  }
  const expandedLog = [
    ...next.commandLog,
    record,
  ]
  if (expandedLog.length > MAX_COMMAND_LOG) {
    const dropped = expandedLog.slice(0, -MAX_COMMAND_LOG)
    let advancedBase = documentFromHistoryBase(next)
    for (const droppedRecord of dropped) {
      advancedBase = applyCadTransaction(
        advancedBase,
        transactionFromRecord(droppedRecord)
      )
    }
    next.historyBase = {
      name: advancedBase.name,
      revision: advancedBase.revision,
      updatedAt: advancedBase.updatedAt,
      features: structuredClone(advancedBase.features),
    }
  }
  next.commandLog = expandedLog.slice(-MAX_COMMAND_LOG)
  return next
}

function rectangleSketchFeature(
  origin: CadFeatureOrigin,
  width: number,
  height: number
): CadSketchFeature {
  const sketchId = cadId('feature')
  const rectangleId = cadId('entity')
  const widthConstraintId = cadId('constraint')
  const heightConstraintId = cadId('constraint')
  return {
    id: sketchId,
    kind: 'sketch',
    name: 'Plate sketch',
    plane: 'XY',
    suppressed: false,
    origin,
    entities: [
      {
        id: rectangleId,
        kind: 'rectangle',
        name: 'Plate outline',
        center: { x: 0, y: 0 },
        widthConstraintId,
        heightConstraintId,
      },
    ],
    constraints: [
      {
        id: widthConstraintId,
        entityId: rectangleId,
        kind: 'width',
        label: 'Plate width',
        value: width,
        driving: true,
      },
      {
        id: heightConstraintId,
        entityId: rectangleId,
        kind: 'height',
        label: 'Plate height',
        value: height,
        driving: true,
      },
    ],
  }
}

export function createMountingPlateTransaction(
  origin: CadFeatureOrigin,
  dimensions: {
    width: number
    height: number
    thickness: number
    holeDiameter: number
    holeEdgeOffset: number
    filletRadius: number
  } = {
    width: 100,
    height: 60,
    thickness: 8,
    holeDiameter: 6,
    holeEdgeOffset: 8,
    filletRadius: 4,
  },
  issuedAt = Date.now()
): CadTransaction {
  const sketch = rectangleSketchFeature(
    origin,
    dimensions.width,
    dimensions.height
  )
  const bodyId = cadId('body')
  const extrude: CadExtrudeFeature = {
    id: cadId('feature'),
    kind: 'extrude',
    name: `Extrude ${dimensions.thickness} mm`,
    suppressed: false,
    origin,
    profileId: sketch.id,
    bodyId,
    distance: dimensions.thickness,
    direction: 'normal',
    operation: 'new',
  }
  const holes: CadHoleFeature = {
    id: cadId('feature'),
    kind: 'hole',
    name: `4 × Ø${dimensions.holeDiameter} mm through-holes`,
    suppressed: false,
    origin,
    bodyId,
    profileId: sketch.id,
    placement: {
      kind: 'rectangular-edge-pattern',
      edgeOffset: dimensions.holeEdgeOffset,
      diameter: dimensions.holeDiameter,
    },
    termination: 'through-all',
  }
  const fillet: CadFilletFeature = {
    id: cadId('feature'),
    kind: 'fillet',
    name: `Corner fillet R${dimensions.filletRadius} mm`,
    suppressed: false,
    origin,
    bodyId,
    profileId: sketch.id,
    radius: dimensions.filletRadius,
    selection: 'outer-vertical-edges',
  }
  return createCadTransaction(
    'Create mounting plate',
    origin,
    [
      { type: 'feature.create', feature: sketch },
      { type: 'feature.create', feature: extrude },
      { type: 'feature.create', feature: holes },
      { type: 'feature.create', feature: fillet },
    ],
    issuedAt
  )
}

export function createSketchFeature(
  name: string,
  origin: CadFeatureOrigin
): CadSketchFeature {
  return {
    id: cadId('feature'),
    kind: 'sketch',
    name,
    plane: 'XY',
    suppressed: false,
    origin,
    entities: [],
    constraints: [],
  }
}

export function createRectangleEntity(
  width = 40,
  height = 30
): {
  entity: CadRectangleEntity
  constraints: CadSketchConstraint[]
} {
  const entityId = cadId('entity')
  const widthConstraintId = cadId('constraint')
  const heightConstraintId = cadId('constraint')
  return {
    entity: {
      id: entityId,
      kind: 'rectangle',
      name: 'Rectangle',
      center: { x: 0, y: 0 },
      widthConstraintId,
      heightConstraintId,
    },
    constraints: [
      {
        id: widthConstraintId,
        entityId,
        kind: 'width',
        label: 'Width',
        value: width,
        driving: true,
      },
      {
        id: heightConstraintId,
        entityId,
        kind: 'height',
        label: 'Height',
        value: height,
        driving: true,
      },
    ],
  }
}

export function createCircleEntity(diameter = 10): {
  entity: CadCircleEntity
  constraints: CadSketchConstraint[]
} {
  const entityId = cadId('entity')
  const diameterConstraintId = cadId('constraint')
  return {
    entity: {
      id: entityId,
      kind: 'circle',
      name: 'Circle',
      center: { x: 0, y: 0 },
      diameterConstraintId,
    },
    constraints: [
      {
        id: diameterConstraintId,
        entityId,
        kind: 'diameter',
        label: 'Diameter',
        value: diameter,
        driving: true,
      },
    ],
  }
}

export function createLineEntity(length = 25): {
  entity: CadLineEntity
  constraints: CadSketchConstraint[]
} {
  const entityId = cadId('entity')
  return {
    entity: {
      id: entityId,
      kind: 'line',
      name: 'Line',
      start: { x: -length / 2, y: 0 },
      end: { x: length / 2, y: 0 },
    },
    constraints: [
      {
        id: cadId('constraint'),
        entityId,
        kind: 'length',
        label: 'Length',
        value: length,
        driving: true,
      },
    ],
  }
}

function recordValue(
  value: unknown,
  label: string
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CadCommandError(
      'invalid-document',
      `${label} must be an object.`
    )
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CadCommandError(
      'invalid-document',
      `${label} must be a nonempty string.`
    )
  }
  return value
}

function finiteValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new CadCommandError(
      'invalid-document',
      `${label} must be a finite number.`
    )
  }
  return value
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new CadCommandError(
      'invalid-document',
      `${label} must be true or false.`
    )
  }
  return value
}

function assertPointShape(value: unknown, label: string): void {
  const point = recordValue(value, label)
  finiteValue(point.x, `${label}.x`)
  finiteValue(point.y, `${label}.y`)
}

function assertFeatureShape(value: unknown, label: string): void {
  const feature = recordValue(value, label)
  stringValue(feature.id, `${label}.id`)
  stringValue(feature.name, `${label}.name`)
  booleanValue(feature.suppressed, `${label}.suppressed`)
  if (feature.origin !== 'manual' && feature.origin !== 'agent') {
    throw new CadCommandError(
      'invalid-document',
      `${label}.origin must be manual or agent.`
    )
  }
  switch (feature.kind) {
    case 'sketch': {
      if (feature.plane !== 'XY') {
        throw new CadCommandError(
          'invalid-document',
          `${label}.plane must be XY.`
        )
      }
      if (!Array.isArray(feature.entities) || !Array.isArray(feature.constraints)) {
        throw new CadCommandError(
          'invalid-document',
          `${label} must contain entity and constraint arrays.`
        )
      }
      feature.entities.forEach((rawEntity, index) => {
        const entityLabel = `${label}.entities[${index}]`
        const entity = recordValue(rawEntity, entityLabel)
        stringValue(entity.id, `${entityLabel}.id`)
        stringValue(entity.name, `${entityLabel}.name`)
        if (
          entity.construction != null &&
          typeof entity.construction !== 'boolean'
        ) {
          throw new CadCommandError(
            'invalid-document',
            `${entityLabel}.construction must be true or false.`
          )
        }
        switch (entity.kind) {
          case 'line':
            assertPointShape(entity.start, `${entityLabel}.start`)
            assertPointShape(entity.end, `${entityLabel}.end`)
            break
          case 'rectangle':
            assertPointShape(entity.center, `${entityLabel}.center`)
            stringValue(
              entity.widthConstraintId,
              `${entityLabel}.widthConstraintId`
            )
            stringValue(
              entity.heightConstraintId,
              `${entityLabel}.heightConstraintId`
            )
            break
          case 'circle':
            assertPointShape(entity.center, `${entityLabel}.center`)
            stringValue(
              entity.diameterConstraintId,
              `${entityLabel}.diameterConstraintId`
            )
            break
          default:
            throw new CadCommandError(
              'invalid-document',
              `${entityLabel}.kind is unsupported.`
            )
        }
      })
      feature.constraints.forEach((rawConstraint, index) => {
        const constraintLabel = `${label}.constraints[${index}]`
        const constraint = recordValue(rawConstraint, constraintLabel)
        stringValue(constraint.id, `${constraintLabel}.id`)
        stringValue(constraint.entityId, `${constraintLabel}.entityId`)
        stringValue(constraint.label, `${constraintLabel}.label`)
        finiteValue(constraint.value, `${constraintLabel}.value`)
        if (
          !['width', 'height', 'diameter', 'length'].includes(
            String(constraint.kind)
          ) ||
          constraint.driving !== true
        ) {
          throw new CadCommandError(
            'invalid-document',
            `${constraintLabel} has an unsupported kind or is not driving.`
          )
        }
      })
      return
    }
    case 'extrude':
      stringValue(feature.profileId, `${label}.profileId`)
      stringValue(feature.bodyId, `${label}.bodyId`)
      finiteValue(feature.distance, `${label}.distance`)
      if (feature.direction !== 'normal' || feature.operation !== 'new') {
        throw new CadCommandError(
          'invalid-document',
          `${label} has an unsupported extrude direction or operation.`
        )
      }
      return
    case 'hole': {
      stringValue(feature.profileId, `${label}.profileId`)
      stringValue(feature.bodyId, `${label}.bodyId`)
      if (feature.termination !== 'through-all') {
        throw new CadCommandError(
          'invalid-document',
          `${label}.termination must be through-all.`
        )
      }
      const placement = recordValue(
        feature.placement,
        `${label}.placement`
      )
      finiteValue(placement.diameter, `${label}.placement.diameter`)
      if (placement.kind === 'rectangular-edge-pattern') {
        finiteValue(placement.edgeOffset, `${label}.placement.edgeOffset`)
      } else if (placement.kind === 'explicit') {
        if (!Array.isArray(placement.centers)) {
          throw new CadCommandError(
            'invalid-document',
            `${label}.placement.centers must be an array.`
          )
        }
        placement.centers.forEach((center, index) =>
          assertPointShape(center, `${label}.placement.centers[${index}]`)
        )
      } else {
        throw new CadCommandError(
          'invalid-document',
          `${label}.placement.kind is unsupported.`
        )
      }
      return
    }
    case 'fillet':
      stringValue(feature.profileId, `${label}.profileId`)
      stringValue(feature.bodyId, `${label}.bodyId`)
      finiteValue(feature.radius, `${label}.radius`)
      if (feature.selection !== 'outer-vertical-edges') {
        throw new CadCommandError(
          'invalid-document',
          `${label}.selection is unsupported.`
        )
      }
      return
    case 'chamfer':
      stringValue(feature.profileId, `${label}.profileId`)
      stringValue(feature.bodyId, `${label}.bodyId`)
      finiteValue(feature.distance, `${label}.distance`)
      if (feature.selection !== 'outer-vertical-edges') {
        throw new CadCommandError(
          'invalid-document',
          `${label}.selection is unsupported.`
        )
      }
      return
    case 'boolean':
      stringValue(feature.bodyId, `${label}.bodyId`)
      stringValue(feature.toolBodyId, `${label}.toolBodyId`)
      if (feature.operation !== 'union' && feature.operation !== 'subtract') {
        throw new CadCommandError(
          'invalid-document',
          `${label}.operation must be union or subtract.`
        )
      }
      return
    default:
      throw new CadCommandError(
        'invalid-document',
        `${label}.kind is unsupported.`
      )
  }
}

const CAD_COMMAND_TYPES = new Set([
  'document.rename',
  'feature.create',
  'feature.update',
  'feature.suppress',
  'feature.delete',
  'sketch.entity.create',
  'sketch.entity.update',
  'sketch.constraint.update',
])

function assertCommandLogShape(value: unknown): void {
  if (!Array.isArray(value)) {
    throw new CadCommandError(
      'invalid-document',
      'commandLog must be an array.'
    )
  }
  value.forEach((rawRecord, recordIndex) => {
    const label = `commandLog[${recordIndex}]`
    const record = recordValue(rawRecord, label)
    stringValue(record.id, `${label}.id`)
    stringValue(record.label, `${label}.label`)
    finiteValue(record.issuedAt, `${label}.issuedAt`)
    finiteValue(record.commandCount, `${label}.commandCount`)
    stringValue(record.beforeFingerprint, `${label}.beforeFingerprint`)
    stringValue(record.afterFingerprint, `${label}.afterFingerprint`)
    if (record.origin !== 'manual' && record.origin !== 'agent') {
      throw new CadCommandError(
        'invalid-document',
        `${label}.origin must be manual or agent.`
      )
    }
    if (record.commands == null) return
    if (!Array.isArray(record.commands)) {
      throw new CadCommandError(
        'invalid-document',
        `${label}.commands must be an array.`
      )
    }
    record.commands.forEach((rawCommand, commandIndex) => {
      const commandLabel = `${label}.commands[${commandIndex}]`
      const command = recordValue(rawCommand, commandLabel)
      if (
        typeof command.type !== 'string' ||
        !CAD_COMMAND_TYPES.has(command.type)
      ) {
        throw new CadCommandError(
          'invalid-document',
          `${commandLabel}.type is unsupported.`
        )
      }
      if (command.type === 'feature.create') {
        assertFeatureShape(command.feature, `${commandLabel}.feature`)
      }
    })
  })
}

function looksLikeCadDocument(value: unknown): value is CadDocument {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CadDocument>
  return (
    candidate.schemaVersion === CAD_DOCUMENT_SCHEMA_VERSION &&
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    candidate.units === 'mm' &&
    typeof candidate.revision === 'number' &&
    typeof candidate.createdAt === 'number' &&
    typeof candidate.updatedAt === 'number' &&
    Array.isArray(candidate.features) &&
    Array.isArray(candidate.commandLog)
  )
}

export function decodeCadDocument(value: unknown): CadDocument {
  const parsed =
    typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!looksLikeCadDocument(parsed)) {
    throw new CadCommandError(
      'invalid-document',
      'This file is not a supported StatsKey parametric CAD document.'
    )
  }
  parsed.features.forEach((feature, index) =>
    assertFeatureShape(feature, `features[${index}]`)
  )
  assertCommandLogShape(parsed.commandLog)
  if (parsed.historyBase != null) {
    const historyBase = recordValue(parsed.historyBase, 'historyBase')
    stringValue(historyBase.name, 'historyBase.name')
    finiteValue(historyBase.revision, 'historyBase.revision')
    finiteValue(historyBase.updatedAt, 'historyBase.updatedAt')
    if (!Array.isArray(historyBase.features)) {
      throw new CadCommandError(
        'invalid-document',
        'historyBase.features must be an array.'
      )
    }
    historyBase.features.forEach((feature, index) =>
      assertFeatureShape(feature, `historyBase.features[${index}]`)
    )
  }
  const document = cloneDocument(parsed)
  const replayableHistory =
    document.historyBase &&
    document.commandLog.every(
      (record) =>
        Array.isArray(record.commands) &&
        record.commands.length === record.commandCount
    )
  if (!replayableHistory) {
    document.historyBase = {
      name: document.name,
      revision: document.revision,
      updatedAt: document.updatedAt,
      features: structuredClone(document.features),
    }
    document.commandLog = []
  }
  validateCadDocument(document)
  if (document.commandLog.length > 0) {
    const replayed = replayCadHistory(document)
    if (cadDocumentFingerprint(replayed) !== cadDocumentFingerprint(document)) {
      throw new CadCommandError(
        'history-fingerprint-mismatch',
        'The saved command history does not reproduce the saved model.'
      )
    }
  }
  return document
}

export function serializeCadDocument(document: CadDocument): string {
  validateCadDocument(document)
  return JSON.stringify(document, null, 2)
}
