export const CAD_DOCUMENT_SCHEMA_VERSION = 1 as const
export const CAD_SESSION_SCHEMA_VERSION = 1 as const

export type CadId = string
export type CadUnits = 'mm'
export type CadFeatureOrigin = 'manual' | 'agent'

export interface CadPoint2 {
  x: number
  y: number
}

export interface CadLineEntity {
  id: CadId
  kind: 'line'
  name: string
  start: CadPoint2
  end: CadPoint2
  construction?: boolean
}

export interface CadRectangleEntity {
  id: CadId
  kind: 'rectangle'
  name: string
  center: CadPoint2
  widthConstraintId: CadId
  heightConstraintId: CadId
}

export interface CadCircleEntity {
  id: CadId
  kind: 'circle'
  name: string
  center: CadPoint2
  diameterConstraintId: CadId
  construction?: boolean
}

export type CadSketchEntity =
  | CadLineEntity
  | CadRectangleEntity
  | CadCircleEntity

export interface CadSketchConstraint {
  id: CadId
  entityId: CadId
  kind: 'width' | 'height' | 'diameter' | 'length'
  label: string
  value: number
  driving: true
}

interface CadFeatureBase {
  id: CadId
  name: string
  suppressed: boolean
  origin: CadFeatureOrigin
}

export interface CadSketchFeature extends CadFeatureBase {
  kind: 'sketch'
  plane: 'XY'
  entities: CadSketchEntity[]
  constraints: CadSketchConstraint[]
}

export interface CadExtrudeFeature extends CadFeatureBase {
  kind: 'extrude'
  profileId: CadId
  bodyId: CadId
  distance: number
  direction: 'normal'
  operation: 'new'
}

export interface CadHoleFeature extends CadFeatureBase {
  kind: 'hole'
  bodyId: CadId
  profileId: CadId
  placement:
    | {
        kind: 'rectangular-edge-pattern'
        edgeOffset: number
        diameter: number
      }
    | {
        kind: 'explicit'
        centers: CadPoint2[]
        diameter: number
      }
  termination: 'through-all'
}

export interface CadFilletFeature extends CadFeatureBase {
  kind: 'fillet'
  bodyId: CadId
  profileId: CadId
  radius: number
  selection: 'outer-vertical-edges'
}

export interface CadChamferFeature extends CadFeatureBase {
  kind: 'chamfer'
  bodyId: CadId
  profileId: CadId
  distance: number
  selection: 'outer-vertical-edges'
}

export interface CadBooleanFeature extends CadFeatureBase {
  kind: 'boolean'
  bodyId: CadId
  toolBodyId: CadId
  operation: 'union' | 'subtract'
}

export type CadFeature =
  | CadSketchFeature
  | CadExtrudeFeature
  | CadHoleFeature
  | CadFilletFeature
  | CadChamferFeature
  | CadBooleanFeature

export type CadFeatureChanges =
  | { kind: 'sketch'; name?: string; plane?: 'XY' }
  | { kind: 'extrude'; name?: string; distance?: number }
  | {
      kind: 'hole'
      name?: string
      diameter?: number
      edgeOffset?: number
    }
  | { kind: 'fillet'; name?: string; radius?: number }
  | { kind: 'chamfer'; name?: string; distance?: number }
  | {
      kind: 'boolean'
      name?: string
      operation?: 'union' | 'subtract'
      toolBodyId?: CadId
    }

export type CadCommand =
  | { type: 'document.rename'; name: string }
  | { type: 'feature.create'; feature: CadFeature }
  | {
      type: 'feature.update'
      featureId: CadId
      changes: CadFeatureChanges
    }
  | { type: 'feature.suppress'; featureId: CadId; suppressed: boolean }
  | { type: 'feature.delete'; featureId: CadId; cascade: boolean }
  | {
      type: 'sketch.entity.create'
      sketchId: CadId
      entity: CadSketchEntity
      constraints: CadSketchConstraint[]
    }
  | {
      type: 'sketch.entity.update'
      sketchId: CadId
      entityId: CadId
      changes: Partial<
        Pick<CadLineEntity, 'name' | 'start' | 'end' | 'construction'> &
          Pick<CadCircleEntity, 'center' | 'construction'> &
          Pick<CadRectangleEntity, 'center'>
      >
    }
  | {
      type: 'sketch.constraint.update'
      sketchId: CadId
      constraintId: CadId
      value: number
    }

export interface CadTransaction {
  id: CadId
  label: string
  origin: CadFeatureOrigin
  issuedAt: number
  commands: CadCommand[]
}

export interface CadCommandRecord {
  id: CadId
  label: string
  origin: CadFeatureOrigin
  issuedAt: number
  commandCount: number
  commands: CadCommand[]
  beforeFingerprint: string
  afterFingerprint: string
}

export interface CadHistoryBase {
  name: string
  revision: number
  updatedAt: number
  features: CadFeature[]
}

export interface CadDocument {
  schemaVersion: typeof CAD_DOCUMENT_SCHEMA_VERSION
  id: CadId
  name: string
  units: CadUnits
  revision: number
  createdAt: number
  updatedAt: number
  features: CadFeature[]
  historyBase: CadHistoryBase
  commandLog: CadCommandRecord[]
}

export interface CadSessionState {
  schemaVersion: typeof CAD_SESSION_SCHEMA_VERSION
  present: CadDocument
  past: CadDocument[]
  future: CadDocument[]
  selectedFeatureId: CadId | null
}

export interface CadFeatureBuildStatus {
  featureId: CadId
  state: 'ok' | 'suppressed' | 'error'
  message: string
}

export interface CadMeshData {
  positions: Float32Array
  indices: Uint32Array
  components?: Array<{
    indexStart: number
    indexCount: number
  }>
}

export interface CadBounds {
  min: [number, number, number]
  max: [number, number, number]
  size: [number, number, number]
}

export interface CadBuildMetrics {
  bounds: CadBounds
  volume: number
  surfaceArea: number
  triangleCount: number
  bodyCount: number
}

export interface CadBuildResult {
  ok: boolean
  documentRevision: number
  mesh?: CadMeshData
  metrics?: CadBuildMetrics
  statuses: CadFeatureBuildStatus[]
  errors: string[]
}

export interface CadAgentProposal {
  id: CadId
  title: string
  explanation: string
  baseFingerprint: string
  transaction: CadTransaction
  changes: string[]
  warnings: string[]
  previewDocument?: CadDocument
  error?: string
}
