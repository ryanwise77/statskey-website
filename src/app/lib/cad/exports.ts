import type { CadBounds, CadMeshData } from './types'

export interface CadExportValidation {
  valid: boolean
  format: 'STL' | 'STEP'
  triangleCount: number
  bounds?: CadBounds
  errors: string[]
}

function cleanNumber(value: number): string {
  if (Math.abs(value) < 1e-10) return '0.'
  const fixed = value.toFixed(9).replace(/0+$/, '').replace(/\.$/, '')
  return fixed.includes('.') ? fixed : `${fixed}.`
}

function meshBounds(positions: ArrayLike<number>): CadBounds | undefined {
  if (positions.length < 3) return undefined
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
  for (let index = 0; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = Number(positions[index + axis])
      min[axis] = Math.min(min[axis], value)
      max[axis] = Math.max(max[axis], value)
    }
  }
  return {
    min,
    max,
    size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]],
  }
}

function triangleNormal(
  positions: Float32Array,
  a: number,
  b: number,
  c: number
): [number, number, number] {
  const ax = positions[a * 3]
  const ay = positions[a * 3 + 1]
  const az = positions[a * 3 + 2]
  const ux = positions[b * 3] - ax
  const uy = positions[b * 3 + 1] - ay
  const uz = positions[b * 3 + 2] - az
  const vx = positions[c * 3] - ax
  const vy = positions[c * 3 + 1] - ay
  const vz = positions[c * 3 + 2] - az
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz)
  return length > 1e-12
    ? [nx / length, ny / length, nz / length]
    : [0, 0, 0]
}

function triangleReferenceDirection(
  positions: Float32Array,
  a: number,
  b: number
): [number, number, number] {
  const x = positions[b * 3] - positions[a * 3]
  const y = positions[b * 3 + 1] - positions[a * 3 + 1]
  const z = positions[b * 3 + 2] - positions[a * 3 + 2]
  const length = Math.hypot(x, y, z)
  if (length <= 1e-12) {
    throw new Error('STEP export found a triangle with a zero-length edge.')
  }
  return [x / length, y / length, z / length]
}

export function exportBinaryStl(
  mesh: CadMeshData,
  modelName: string
): ArrayBuffer {
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new Error('STL export requires at least one complete triangle.')
  }
  const triangleCount = mesh.indices.length / 3
  const buffer = new ArrayBuffer(84 + triangleCount * 50)
  const view = new DataView(buffer)
  const header = new TextEncoder().encode(
    `StatsKey CAD · ${modelName}`.slice(0, 80)
  )
  new Uint8Array(buffer, 0, header.length).set(header)
  view.setUint32(80, triangleCount, true)
  let offset = 84
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = mesh.indices[triangle * 3]
    const b = mesh.indices[triangle * 3 + 1]
    const c = mesh.indices[triangle * 3 + 2]
    const normal = triangleNormal(mesh.positions, a, b, c)
    for (const value of normal) {
      view.setFloat32(offset, value, true)
      offset += 4
    }
    for (const vertex of [a, b, c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        view.setFloat32(
          offset,
          mesh.positions[vertex * 3 + axis],
          true
        )
        offset += 4
      }
    }
    view.setUint16(offset, 0, true)
    offset += 2
  }
  return buffer
}

class StepEntityWriter {
  private nextId = 1
  readonly lines: string[] = []

  add(expression: string): number {
    const id = this.nextId
    this.nextId += 1
    this.lines.push(`#${id}=${expression};`)
    return id
  }

  ref(id: number): string {
    return `#${id}`
  }
}

function escapeStepString(value: string): string {
  return value.replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '_')
}

export function exportFacetedStep(
  mesh: CadMeshData,
  modelName: string,
  timestamp = new Date()
): string {
  if (mesh.indices.length === 0 || mesh.indices.length % 3 !== 0) {
    throw new Error('STEP export requires at least one complete triangle.')
  }
  const writer = new StepEntityWriter()
  const appContext = writer.add(
    "APPLICATION_CONTEXT('core data for mechanical design')"
  )
  writer.add(
    `APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${writer.ref(appContext)})`
  )
  const productContext = writer.add(
    `PRODUCT_CONTEXT('',${writer.ref(appContext)},'mechanical')`
  )
  const safeName = escapeStepString(modelName)
  const product = writer.add(
    `PRODUCT('${safeName}','${safeName}','',(${writer.ref(productContext)}))`
  )
  const productDefinitionContext = writer.add(
    `PRODUCT_DEFINITION_CONTEXT('part definition',${writer.ref(appContext)},'design')`
  )
  const formation = writer.add(
    `PRODUCT_DEFINITION_FORMATION('','',${writer.ref(product)})`
  )
  const productDefinition = writer.add(
    `PRODUCT_DEFINITION('design','',${writer.ref(formation)},${writer.ref(productDefinitionContext)})`
  )
  const productShape = writer.add(
    `PRODUCT_DEFINITION_SHAPE('','',${writer.ref(productDefinition)})`
  )
  const lengthUnit = writer.add(
    '(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))'
  )
  const angleUnit = writer.add(
    '(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))'
  )
  const solidAngleUnit = writer.add(
    '(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())'
  )
  const uncertainty = writer.add(
    `(LENGTH_MEASURE_WITH_UNIT()MEASURE_REPRESENTATION_ITEM()MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${writer.ref(lengthUnit)})REPRESENTATION_ITEM('distance_accuracy_value'))`
  )
  const context = writer.add(
    `(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${writer.ref(uncertainty)}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${writer.ref(lengthUnit)},${writer.ref(angleUnit)},${writer.ref(solidAngleUnit)}))REPRESENTATION_CONTEXT('StatsKey CAD','3D'))`
  )

  const pointRefs: number[] = []
  for (let index = 0; index < mesh.positions.length; index += 3) {
    pointRefs.push(
      writer.add(
        `CARTESIAN_POINT('vertex',(${cleanNumber(mesh.positions[index])},${cleanNumber(mesh.positions[index + 1])},${cleanNumber(mesh.positions[index + 2])}))`
      )
    )
  }
  const components =
    mesh.components && mesh.components.length > 0
      ? mesh.components
      : [{ indexStart: 0, indexCount: mesh.indices.length }]
  let expectedStart = 0
  for (const component of components) {
    if (
      component.indexStart !== expectedStart ||
      component.indexStart % 3 !== 0 ||
      component.indexCount <= 0 ||
      component.indexCount % 3 !== 0 ||
      component.indexStart + component.indexCount > mesh.indices.length
    ) {
      throw new Error(
        'STEP export requires contiguous, complete triangle ranges for every solid body.'
      )
    }
    expectedStart += component.indexCount
  }
  if (expectedStart !== mesh.indices.length) {
    throw new Error('STEP export body ranges do not cover the complete mesh.')
  }

  const solidRefs: number[] = []
  for (const [componentIndex, component] of components.entries()) {
    const faceRefs: number[] = []
    const end = component.indexStart + component.indexCount
    for (let index = component.indexStart; index < end; index += 3) {
      const aIndex = mesh.indices[index]
      const bIndex = mesh.indices[index + 1]
      const cIndex = mesh.indices[index + 2]
      const a = pointRefs[aIndex]
      const b = pointRefs[bIndex]
      const c = pointRefs[cIndex]
      const normal = triangleNormal(mesh.positions, aIndex, bIndex, cIndex)
      if (Math.hypot(...normal) <= 1e-12) {
        throw new Error('STEP export found a degenerate triangle.')
      }
      const reference = triangleReferenceDirection(
        mesh.positions,
        aIndex,
        bIndex
      )
      const loop = writer.add(
        `POLY_LOOP('',(${writer.ref(a)},${writer.ref(b)},${writer.ref(c)}))`
      )
      const bound = writer.add(
        `FACE_OUTER_BOUND('',${writer.ref(loop)},.T.)`
      )
      const normalDirection = writer.add(
        `DIRECTION('',(${normal.map(cleanNumber).join(',')}))`
      )
      const referenceDirection = writer.add(
        `DIRECTION('',(${reference.map(cleanNumber).join(',')}))`
      )
      const placement = writer.add(
        `AXIS2_PLACEMENT_3D('',${writer.ref(a)},${writer.ref(normalDirection)},${writer.ref(referenceDirection)})`
      )
      const plane = writer.add(`PLANE('',${writer.ref(placement)})`)
      faceRefs.push(
        writer.add(
          `FACE_SURFACE('',(${writer.ref(bound)}),${writer.ref(plane)},.T.)`
        )
      )
    }
    const shell = writer.add(
      `CLOSED_SHELL('',(${faceRefs.map((id) => writer.ref(id)).join(',')}))`
    )
    solidRefs.push(
      writer.add(
        `FACETED_BREP('${safeName}${components.length > 1 ? ` body ${componentIndex + 1}` : ''}',${writer.ref(shell)})`
      )
    )
  }
  const representation = writer.add(
    `SHAPE_REPRESENTATION('',(${solidRefs.map((id) => writer.ref(id)).join(',')}),${writer.ref(context)})`
  )
  writer.add(
    `SHAPE_DEFINITION_REPRESENTATION(${writer.ref(productShape)},${writer.ref(representation)})`
  )

  const isoTimestamp = timestamp.toISOString().replace(/\.\d{3}Z$/, '')
  return [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('StatsKey parametric mechanical CAD'),'2;1');",
    `FILE_NAME('${safeName}.step','${isoTimestamp}',('StatsKey'),('StatsKey'),'StatsKey CAD','StatsKey','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));",
    'ENDSEC;',
    'DATA;',
    ...writer.lines,
    'ENDSEC;',
    'END-ISO-10303-21;',
    '',
  ].join('\n')
}

function dimensionsMatch(
  bounds: CadBounds | undefined,
  expectedSize: [number, number, number] | undefined,
  tolerance: number,
  errors: string[]
): void {
  if (!bounds || !expectedSize) return
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(bounds.size[axis] - expectedSize[axis]) > tolerance) {
      errors.push(
        `Axis ${'XYZ'[axis]} measures ${bounds.size[axis].toFixed(4)} mm; expected ${expectedSize[axis].toFixed(4)} mm.`
      )
    }
  }
}

export function validateBinaryStl(
  buffer: ArrayBuffer,
  expectedSize?: [number, number, number],
  tolerance = 0.01
): CadExportValidation {
  const errors: string[] = []
  if (buffer.byteLength < 84) {
    return {
      valid: false,
      format: 'STL',
      triangleCount: 0,
      errors: ['The STL is shorter than its required 84-byte header.'],
    }
  }
  const view = new DataView(buffer)
  const triangleCount = view.getUint32(80, true)
  const expectedLength = 84 + triangleCount * 50
  if (expectedLength !== buffer.byteLength) {
    errors.push(
      `The STL declares ${triangleCount} triangles but has ${buffer.byteLength} bytes; ${expectedLength} bytes are required.`
    )
  }
  const positions: number[] = []
  const readableTriangles = Math.min(
    triangleCount,
    Math.floor((buffer.byteLength - 84) / 50)
  )
  for (let triangle = 0; triangle < readableTriangles; triangle += 1) {
    const base = 84 + triangle * 50 + 12
    for (let coordinate = 0; coordinate < 9; coordinate += 1) {
      const value = view.getFloat32(base + coordinate * 4, true)
      if (!Number.isFinite(value)) {
        errors.push(`Triangle ${triangle + 1} contains a non-finite coordinate.`)
        break
      }
      positions.push(value)
    }
  }
  const bounds = meshBounds(positions)
  dimensionsMatch(bounds, expectedSize, tolerance, errors)
  if (triangleCount === 0) errors.push('The STL contains no triangles.')
  return {
    valid: errors.length === 0,
    format: 'STL',
    triangleCount,
    bounds,
    errors,
  }
}

export function validateFacetedStep(
  step: string,
  expectedSize?: [number, number, number],
  tolerance = 0.01
): CadExportValidation {
  const errors: string[] = []
  if (!step.startsWith('ISO-10303-21;')) {
    errors.push('Missing ISO-10303-21 start marker.')
  }
  if (!step.trimEnd().endsWith('END-ISO-10303-21;')) {
    errors.push('Missing END-ISO-10303-21 marker.')
  }
  const entities = new Map<number, string>()
  for (const match of step.matchAll(/#(\d+)\s*=\s*([^;]+);/g)) {
    entities.set(Number(match[1]), match[2])
  }
  for (const [id, expression] of entities) {
    for (const reference of expression.matchAll(/#(\d+)/g)) {
      const referencedId = Number(reference[1])
      if (!entities.has(referencedId)) {
        errors.push(`Entity #${id} references missing entity #${referencedId}.`)
      }
    }
  }
  const positions: number[] = []
  for (const expression of entities.values()) {
    const point = expression.match(
      /^CARTESIAN_POINT\('vertex',\(\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*,\s*([-+\d.eE]+)\s*\)\)$/
    )
    if (!point) continue
    positions.push(Number(point[1]), Number(point[2]), Number(point[3]))
  }
  const faceCount = [...entities.values()].filter((expression) =>
    /^FACE_SURFACE\(/.test(expression)
  ).length
  if (faceCount === 0) {
    errors.push(
      'The STEP file contains no explicit planar faceted faces that interoperable readers can reconstruct.'
    )
  }
  if (
    ![...entities.values()].some((expression) =>
      /^CLOSED_SHELL\(/.test(expression)
    )
  ) {
    errors.push('The STEP file does not contain a closed shell.')
  }
  if (
    ![...entities.values()].some((expression) =>
      /^FACETED_BREP\(/.test(expression)
    )
  ) {
    errors.push('The STEP file does not contain a faceted B-Rep solid.')
  }
  const bounds = meshBounds(positions)
  dimensionsMatch(bounds, expectedSize, tolerance, errors)
  return {
    valid: errors.length === 0,
    format: 'STEP',
    triangleCount: faceCount,
    bounds,
    errors,
  }
}

export function safeCadFileName(name: string): string {
  const normalized = name
    .trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'statskey-model'
}
