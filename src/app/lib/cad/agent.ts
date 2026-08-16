import {
  applyCadTransaction,
  cadDocumentFingerprint,
  cadId,
  createCadTransaction,
  createCircleEntity,
  createLineEntity,
  createMountingPlateTransaction,
  createRectangleEntity,
  createSketchFeature,
  sketchRectangleDimensions,
} from './document'
import type {
  CadAgentProposal,
  CadBooleanFeature,
  CadChamferFeature,
  CadCommand,
  CadDocument,
  CadExtrudeFeature,
  CadFeature,
  CadFilletFeature,
  CadHoleFeature,
  CadSketchFeature,
  CadTransaction,
} from './types'

interface PlannedAgentChange {
  title: string
  explanation: string
  transaction: CadTransaction
  changes: string[]
  warnings?: string[]
}

function numberFromMatch(match: RegExpMatchArray | null): number | null {
  if (!match?.[1]) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function lastFeature<T extends CadFeature['kind']>(
  document: CadDocument,
  kind: T
): Extract<CadFeature, { kind: T }> | undefined {
  return [...document.features]
    .reverse()
    .find(
      (feature): feature is Extract<CadFeature, { kind: T }> =>
        feature.kind === kind && !feature.suppressed
    )
}

function activeSketch(document: CadDocument): CadSketchFeature | undefined {
  return lastFeature(document, 'sketch')
}

function activeBodyAndProfile(document: CadDocument): {
  bodyId: string
  profileId: string
} | null {
  const extrudes = document.features.filter(
    (feature): feature is CadExtrudeFeature =>
      feature.kind === 'extrude' && !feature.suppressed
  )
  const liveBodyIds = new Set(extrudes.map((feature) => feature.bodyId))
  for (const feature of document.features) {
    if (feature.kind === 'boolean' && !feature.suppressed) {
      liveBodyIds.delete(feature.toolBodyId)
    }
  }
  const extrude = [...extrudes]
    .reverse()
    .find((feature) => liveBodyIds.has(feature.bodyId))
  return extrude
    ? { bodyId: extrude.bodyId, profileId: extrude.profileId }
    : null
}

function planMountingPlate(
  document: CadDocument,
  text: string
): PlannedAgentChange | null {
  const normalized = text.replace(/,/g, ' ')
  const explicitDsl = normalized.match(
    /plate\s*\(\s*width\s*=\s*([\d.]+)\s*(?:mm)?\s+height\s*=\s*([\d.]+)\s*(?:mm)?\s+thickness\s*=\s*([\d.]+)\s*(?:mm)?(?:\s+holes?\s*=\s*([\d.]+)\s*(?:mm)?)?(?:\s+offset\s*=\s*([\d.]+)\s*(?:mm)?)?(?:\s+fillet\s*=\s*([\d.]+)\s*(?:mm)?)?\s*\)/i
  )
  const dimensions = normalized.match(
    /([\d.]+)\s*(?:×|x|by)\s*([\d.]+)\s*(?:×|x|by)\s*([\d.]+)\s*mm/i
  )
  const isMountingPlate =
    /mounting\s+plate/i.test(text) ||
    Boolean(explicitDsl) ||
    (Boolean(dimensions) && /(?:through[-\s]?holes?|corner\s+fillets?)/i.test(text))
  if (!isMountingPlate) return null

  const width = Number(explicitDsl?.[1] ?? dimensions?.[1] ?? 100)
  const height = Number(explicitDsl?.[2] ?? dimensions?.[2] ?? 60)
  const thickness = Number(explicitDsl?.[3] ?? dimensions?.[3] ?? 8)
  const holeDiameter = Number(
    explicitDsl?.[4] ??
      numberFromMatch(
        normalized.match(
          /(?:four|4)\s+([\d.]+)\s*mm\s+(?:diameter\s+)?through[-\s]?holes?/i
        )
      ) ??
      numberFromMatch(
        normalized.match(
          /(?:holes?|through[-\s]?holes?)[^\d]{0,18}([\d.]+)\s*mm/i
        )
      ) ??
      6
  )
  const holeEdgeOffset = Number(
    explicitDsl?.[5] ??
      numberFromMatch(
        normalized.match(/centered\s+([\d.]+)\s*mm\s+from/i)
      ) ??
      numberFromMatch(normalized.match(/edge\s+offset\s+([\d.]+)\s*mm/i)) ??
      8
  )
  const filletRadius = Number(
    explicitDsl?.[6] ??
      numberFromMatch(
        normalized.match(/([\d.]+)\s*mm\s+corner\s+fillets?/i)
      ) ??
      numberFromMatch(normalized.match(/fillet(?:\s+radius)?\s+([\d.]+)/i)) ??
      4
  )
  const transaction = createMountingPlateTransaction('agent', {
    width,
    height,
    thickness,
    holeDiameter,
    holeEdgeOffset,
    filletRadius,
  })
  return {
    title: 'Create a parametric mounting plate',
    explanation:
      'The plan creates an editable sketch, extrudes it, cuts a parametric four-hole pattern, and rounds the four outside corners. Each step will remain in the shared feature tree.',
    transaction,
    changes: [
      `Create a ${width} × ${height} mm driving rectangle`,
      `Extrude a new body to ${thickness} mm`,
      `Cut four Ø${holeDiameter} mm through-holes ${holeEdgeOffset} mm from their nearest edges`,
      `Apply ${filletRadius} mm outer corner fillets`,
    ],
    warnings:
      document.features.length > 0
        ? ['This adds a new body to the current document; existing features remain unchanged.']
        : [],
  }
}

function planDimensionalRevision(
  document: CadDocument,
  text: string
): PlannedAgentChange | null {
  const sketch = [...document.features]
    .reverse()
    .find(
      (feature): feature is CadSketchFeature =>
        feature.kind === 'sketch' &&
        !feature.suppressed &&
        sketchRectangleDimensions(feature) != null
    )
  if (!sketch) return null
  const dimensions = sketchRectangleDimensions(sketch)
  if (!dimensions) return null
  const commands: CadCommand[] = []
  const changes: string[] = []

  const widthConstraint = sketch.constraints.find(
    (constraint) =>
      constraint.id === dimensions.rectangle.widthConstraintId
  )
  const heightConstraint = sketch.constraints.find(
    (constraint) =>
      constraint.id === dimensions.rectangle.heightConstraintId
  )
  const widthFromTo = text.match(
    /width\s+from\s+[\d.]+\s*(?:mm)?\s+to\s+([\d.]+)/i
  )
  const widthTo = text.match(
    /(?:make|set|change)?\s*(?:the\s+)?(?:plate\s+)?width(?:\s+to|[=:])\s*([\d.]+)/i
  )
  const widerBy = text.match(/([\d.]+)\s*mm\s+wider/i)
  const narrowerBy = text.match(/([\d.]+)\s*mm\s+narrower/i)
  const targetWidth =
    numberFromMatch(widthFromTo) ??
    numberFromMatch(widthTo) ??
    (widerBy ? dimensions.width + Number(widerBy[1]) : null) ??
    (narrowerBy ? dimensions.width - Number(narrowerBy[1]) : null)
  if (targetWidth != null && widthConstraint) {
    commands.push({
      type: 'sketch.constraint.update',
      sketchId: sketch.id,
      constraintId: widthConstraint.id,
      value: targetWidth,
    })
    changes.push(`Plate width: ${dimensions.width} → ${targetWidth} mm`)
  }

  const heightFromTo = text.match(
    /height\s+from\s+[\d.]+\s*(?:mm)?\s+to\s+([\d.]+)/i
  )
  const heightTo = text.match(
    /(?:make|set|change)?\s*(?:the\s+)?(?:plate\s+)?height(?:\s+to|[=:])\s*([\d.]+)/i
  )
  const tallerBy = text.match(/([\d.]+)\s*mm\s+taller/i)
  const shorterBy = text.match(/([\d.]+)\s*mm\s+shorter/i)
  const targetHeight =
    numberFromMatch(heightFromTo) ??
    numberFromMatch(heightTo) ??
    (tallerBy ? dimensions.height + Number(tallerBy[1]) : null) ??
    (shorterBy ? dimensions.height - Number(shorterBy[1]) : null)
  if (targetHeight != null && heightConstraint) {
    commands.push({
      type: 'sketch.constraint.update',
      sketchId: sketch.id,
      constraintId: heightConstraint.id,
      value: targetHeight,
    })
    changes.push(`Plate height: ${dimensions.height} → ${targetHeight} mm`)
  }

  const extrude = lastFeature(document, 'extrude')
  const thicknessTo = text.match(
    /(?:thickness|thick)(?:\s+to|[=:]|\s+is)?\s*([\d.]+)\s*mm/i
  )
  if (extrude && thicknessTo) {
    const value = Number(thicknessTo[1])
    commands.push({
      type: 'feature.update',
      featureId: extrude.id,
      changes: { kind: 'extrude', distance: value },
    })
    changes.push(`Thickness: ${extrude.distance} → ${value} mm`)
  }

  const holes = lastFeature(document, 'hole')
  if (holes) {
    const diameterTo = text.match(
      /(?:hole\s+diameter|holes?\s+(?:to|diameter))\s*([\d.]+)\s*mm/i
    )
    if (diameterTo) {
      const value = Number(diameterTo[1])
      commands.push({
        type: 'feature.update',
        featureId: holes.id,
        changes: { kind: 'hole', diameter: value },
      })
      changes.push(
        `Hole diameter: ${holes.placement.diameter} → ${value} mm`
      )
    }
    if (holes.placement.kind === 'rectangular-edge-pattern') {
      const inward = text.match(/move\s+(?:the\s+)?holes?\s+([\d.]+)\s*mm\s+inward/i)
      const outward = text.match(/move\s+(?:the\s+)?holes?\s+([\d.]+)\s*mm\s+outward/i)
      const offsetTo = text.match(
        /(?:hole\s+)?edge\s+offset(?:\s+to|[=:])\s*([\d.]+)\s*mm/i
      )
      const targetOffset = inward
        ? holes.placement.edgeOffset + Number(inward[1])
        : outward
          ? holes.placement.edgeOffset - Number(outward[1])
          : numberFromMatch(offsetTo)
      if (targetOffset != null) {
        commands.push({
          type: 'feature.update',
          featureId: holes.id,
          changes: { kind: 'hole', edgeOffset: targetOffset },
        })
        changes.push(
          `Hole edge offset: ${holes.placement.edgeOffset} → ${targetOffset} mm`
        )
      }
    }
  }

  const fillet = lastFeature(document, 'fillet')
  const filletTo = text.match(
    /(?:fillet(?:\s+radius)?|corner\s+radius)(?:\s+to|[=:]|\s+is)?\s*([\d.]+)\s*mm/i
  )
  if (fillet && filletTo) {
    const value = Number(filletTo[1])
    commands.push({
      type: 'feature.update',
      featureId: fillet.id,
      changes: { kind: 'fillet', radius: value },
    })
    changes.push(`Corner fillet: ${fillet.radius} → ${value} mm`)
  }

  if (commands.length === 0) return null
  return {
    title: 'Revise model parameters',
    explanation:
      'These edits target the existing driving dimensions. Dependent holes and edge treatments will rebuild from the same feature definitions.',
    transaction: createCadTransaction(
      changes.length === 1 ? changes[0] : 'Revise model parameters',
      'agent',
      commands
    ),
    changes,
  }
}

function parsePoint(
  text: string,
  label: 'from' | 'to' | 'at'
): { x: number; y: number } | null {
  const match = text.match(
    new RegExp(`${label}\\s*\\(?\\s*(-?[\\d.]+)\\s*[, ]\\s*(-?[\\d.]+)`, 'i')
  )
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null
}

function planFeatureCreation(
  document: CadDocument,
  text: string
): PlannedAgentChange | null {
  if (/(?:create|add|start)\s+(?:a\s+)?(?:new\s+)?sketch/i.test(text)) {
    const sketch = createSketchFeature('Sketch', 'agent')
    return {
      title: 'Create a sketch',
      explanation:
        'Create an editable sketch on the XY plane. Manual tools can add geometry and dimensions after execution.',
      transaction: createCadTransaction('Create sketch', 'agent', [
        { type: 'feature.create', feature: sketch },
      ]),
      changes: ['Add Sketch to the feature tree'],
    }
  }

  const rectangle = text.match(
    /(?:add|create|draw)\s+(?:a\s+)?rectangle(?:\s+([\d.]+)\s*(?:×|x|by)\s*([\d.]+))?/i
  )
  if (rectangle) {
    const existingSketch = activeSketch(document)
    const sketch = existingSketch ?? createSketchFeature('Sketch', 'agent')
    const created = createRectangleEntity(
      Number(rectangle[1] ?? 40),
      Number(rectangle[2] ?? 30)
    )
    const commands: CadCommand[] = existingSketch
      ? []
      : [{ type: 'feature.create', feature: sketch }]
    commands.push({
      type: 'sketch.entity.create',
      sketchId: sketch.id,
      entity: created.entity,
      constraints: created.constraints,
    })
    return {
      title: 'Add a constrained rectangle',
      explanation:
        'The rectangle width and height are driving dimensions in the sketch.',
      transaction: createCadTransaction('Add rectangle', 'agent', commands),
      changes: [
        `Add ${created.constraints[0].value} × ${created.constraints[1].value} mm rectangle`,
      ],
    }
  }

  const circle = text.match(
    /(?:add|create|draw)\s+(?:a\s+)?circle(?:\s+(?:diameter|ø)?\s*([\d.]+))?/i
  )
  if (circle) {
    const existingSketch = activeSketch(document)
    const sketch = existingSketch ?? createSketchFeature('Sketch', 'agent')
    const created = createCircleEntity(Number(circle[1] ?? 10))
    const at = parsePoint(text, 'at')
    if (at) created.entity.center = at
    const commands: CadCommand[] = existingSketch
      ? []
      : [{ type: 'feature.create', feature: sketch }]
    commands.push({
      type: 'sketch.entity.create',
      sketchId: sketch.id,
      entity: created.entity,
      constraints: created.constraints,
    })
    return {
      title: 'Add a constrained circle',
      explanation:
        'The circle diameter remains editable in the sketch inspector.',
      transaction: createCadTransaction('Add circle', 'agent', commands),
      changes: [`Add Ø${created.constraints[0].value} mm circle`],
    }
  }

  if (/(?:add|create|draw)\s+(?:a\s+)?line/i.test(text)) {
    const existingSketch = activeSketch(document)
    const sketch = existingSketch ?? createSketchFeature('Sketch', 'agent')
    const start = parsePoint(text, 'from')
    const end = parsePoint(text, 'to')
    const created = createLineEntity(
      start && end ? Math.hypot(end.x - start.x, end.y - start.y) : 25
    )
    if (start && end) {
      created.entity.start = start
      created.entity.end = end
    }
    const commands: CadCommand[] = existingSketch
      ? []
      : [{ type: 'feature.create', feature: sketch }]
    commands.push({
      type: 'sketch.entity.create',
      sketchId: sketch.id,
      entity: created.entity,
      constraints: created.constraints,
    })
    return {
      title: 'Add a dimensional line',
      explanation:
        'The line endpoints and driving length remain editable in the sketch inspector.',
      transaction: createCadTransaction('Add line', 'agent', commands),
      changes: [`Add ${created.constraints[0].value.toFixed(2)} mm line`],
    }
  }

  const extrudeMatch = text.match(
    /(?:add|create|make)?\s*extrude(?:\s+(?:to|by))?\s*([\d.]+)\s*mm/i
  )
  if (extrudeMatch) {
    const sketch = activeSketch(document)
    if (!sketch) return null
    const distance = Number(extrudeMatch[1])
    const extrude: CadExtrudeFeature = {
      id: cadId('feature'),
      kind: 'extrude',
      name: `Extrude ${distance} mm`,
      suppressed: false,
      origin: 'agent',
      profileId: sketch.id,
      bodyId: cadId('body'),
      distance,
      direction: 'normal',
      operation: 'new',
    }
    return {
      title: 'Extrude the active sketch',
      explanation:
        'Create a new parametric solid body from the active closed sketch regions.',
      transaction: createCadTransaction('Extrude sketch', 'agent', [
        { type: 'feature.create', feature: extrude },
      ]),
      changes: [`Extrude ${sketch.name} by ${distance} mm`],
    }
  }

  const body = activeBodyAndProfile(document)
  if (!body) return null

  const holeMatch = text.match(
    /(?:add|create|cut)\s+(?:four|4)\s+(?:ø\s*)?([\d.]+)\s*mm\s+(?:through[-\s]?)?holes?.*?(?:offset|from\s+(?:the\s+)?edges?)\s*([\d.]+)\s*mm/i
  )
  if (holeMatch) {
    const feature: CadHoleFeature = {
      id: cadId('feature'),
      kind: 'hole',
      name: `4 × Ø${holeMatch[1]} mm through-holes`,
      origin: 'agent',
      suppressed: false,
      bodyId: body.bodyId,
      profileId: body.profileId,
      placement: {
        kind: 'rectangular-edge-pattern',
        diameter: Number(holeMatch[1]),
        edgeOffset: Number(holeMatch[2]),
      },
      termination: 'through-all',
    }
    return {
      title: 'Cut a four-hole pattern',
      explanation:
        'The hole diameter and nearest-edge offset are editable pattern parameters.',
      transaction: createCadTransaction('Add through-holes', 'agent', [
        { type: 'feature.create', feature },
      ]),
      changes: [
        `Cut four Ø${holeMatch[1]} mm through-holes ${holeMatch[2]} mm from the edges`,
      ],
    }
  }

  const filletMatch = text.match(
    /(?:add|apply|create)\s+(?:a\s+)?(?:corner\s+)?fillet(?:\s+(?:of|radius))?\s*([\d.]+)\s*mm/i
  )
  if (filletMatch) {
    const feature: CadFilletFeature = {
      id: cadId('feature'),
      kind: 'fillet',
      name: `Corner fillet R${filletMatch[1]} mm`,
      origin: 'agent',
      suppressed: false,
      bodyId: body.bodyId,
      profileId: body.profileId,
      radius: Number(filletMatch[1]),
      selection: 'outer-vertical-edges',
    }
    return {
      title: 'Fillet outside corners',
      explanation:
        'Round the four outside vertical edges while preserving downstream editability.',
      transaction: createCadTransaction('Add corner fillet', 'agent', [
        { type: 'feature.create', feature },
      ]),
      changes: [`Apply ${filletMatch[1]} mm corner fillets`],
    }
  }

  const chamferMatch = text.match(
    /(?:add|apply|create)\s+(?:a\s+)?(?:corner\s+)?chamfer(?:\s+(?:of|distance))?\s*([\d.]+)\s*mm/i
  )
  if (chamferMatch) {
    const feature: CadChamferFeature = {
      id: cadId('feature'),
      kind: 'chamfer',
      name: `Corner chamfer ${chamferMatch[1]} mm`,
      origin: 'agent',
      suppressed: false,
      bodyId: body.bodyId,
      profileId: body.profileId,
      distance: Number(chamferMatch[1]),
      selection: 'outer-vertical-edges',
    }
    return {
      title: 'Chamfer outside corners',
      explanation:
        'Cut equal-distance chamfers on the four outside vertical edges.',
      transaction: createCadTransaction('Add corner chamfer', 'agent', [
        { type: 'feature.create', feature },
      ]),
      changes: [`Apply ${chamferMatch[1]} mm corner chamfers`],
    }
  }

  const booleanMatch = text.match(/boolean\s+(union|subtract)/i)
  if (booleanMatch) {
    const extrudes = document.features.filter(
      (feature): feature is CadExtrudeFeature =>
        feature.kind === 'extrude' && !feature.suppressed
    )
    if (extrudes.length < 2) return null
    const [target, tool] = extrudes.slice(-2)
    const feature: CadBooleanFeature = {
      id: cadId('feature'),
      kind: 'boolean',
      name: `Boolean ${booleanMatch[1].toLowerCase()}`,
      origin: 'agent',
      suppressed: false,
      bodyId: target.bodyId,
      toolBodyId: tool.bodyId,
      operation: booleanMatch[1].toLowerCase() as 'union' | 'subtract',
    }
    return {
      title: feature.name,
      explanation:
        'Combine the two most recent solid bodies through the shared deterministic boolean feature.',
      transaction: createCadTransaction(feature.name, 'agent', [
        { type: 'feature.create', feature },
      ]),
      changes: [`${feature.operation} the two most recent bodies`],
    }
  }

  return null
}

function featureBySpokenName(
  document: CadDocument,
  spokenName: string
): CadFeature | undefined {
  const normalized = spokenName.trim().toLowerCase()
  return [...document.features]
    .reverse()
    .find(
      (feature) =>
        feature.name.toLowerCase().includes(normalized) ||
        feature.kind === normalized
    )
}

function planFeatureLifecycle(
  document: CadDocument,
  text: string
): PlannedAgentChange | null {
  const match = text.match(
    /\b(suppress|unsuppress|enable|delete|remove)\s+(?:the\s+)?(.+?)(?:\s+feature)?[.!]?$/i
  )
  if (!match) return null
  const verb = match[1].toLowerCase()
  const feature = featureBySpokenName(document, match[2])
  if (!feature) return null
  const deleting = verb === 'delete' || verb === 'remove'
  const suppressed = verb === 'suppress'
  return {
    title: deleting
      ? `Delete ${feature.name}`
      : `${suppressed ? 'Suppress' : 'Enable'} ${feature.name}`,
    explanation: deleting
      ? 'Delete the selected feature and its dependent features as one inspectable transaction.'
      : 'Toggle the feature without deleting its parameters or history.',
    transaction: createCadTransaction(
      deleting ? `Delete ${feature.name}` : `${suppressed ? 'Suppress' : 'Enable'} ${feature.name}`,
      'agent',
      [
        deleting
          ? { type: 'feature.delete', featureId: feature.id, cascade: true }
          : {
              type: 'feature.suppress',
              featureId: feature.id,
              suppressed,
            },
      ]
    ),
    changes: [
      deleting
        ? `Delete ${feature.name} and dependent features`
        : `${suppressed ? 'Suppress' : 'Enable'} ${feature.name}`,
    ],
  }
}

function plannedChange(
  document: CadDocument,
  prompt: string
): PlannedAgentChange | null {
  return (
    planDimensionalRevision(document, prompt) ??
    planMountingPlate(document, prompt) ??
    planFeatureLifecycle(document, prompt) ??
    planFeatureCreation(document, prompt)
  )
}

export function proposeCadAgentAction(
  document: CadDocument,
  prompt: string
): CadAgentProposal {
  const cleanPrompt = prompt.trim()
  const id = cadId('proposal')
  const baseFingerprint = cadDocumentFingerprint(document)
  if (!cleanPrompt) {
    return {
      id,
      title: 'Describe a modeling change',
      explanation: '',
      baseFingerprint,
      transaction: createCadTransaction('Empty proposal', 'agent', []),
      changes: [],
      warnings: [],
      error: 'Describe the part or revision you want to preview.',
    }
  }
  const plan = plannedChange(document, cleanPrompt)
  if (!plan) {
    return {
      id,
      title: 'More detail is needed',
      explanation: '',
      baseFingerprint,
      transaction: createCadTransaction('Unrecognized request', 'agent', []),
      changes: [],
      warnings: [],
      error:
        'I could not map that request to a deterministic CAD feature yet. Try a mounting plate description, “make the plate 20 mm wider,” “move the holes 3 mm inward,” or a direct sketch/extrude/hole/fillet/chamfer command.',
    }
  }
  try {
    const previewDocument = applyCadTransaction(document, plan.transaction)
    return {
      id,
      title: plan.title,
      explanation: plan.explanation,
      baseFingerprint,
      transaction: plan.transaction,
      changes: plan.changes,
      warnings: plan.warnings ?? [],
      previewDocument,
    }
  } catch (error) {
    return {
      id,
      title: plan.title,
      explanation: plan.explanation,
      baseFingerprint,
      transaction: plan.transaction,
      changes: plan.changes,
      warnings: plan.warnings ?? [],
      error: error instanceof Error ? error.message : 'The preview could not be built.',
    }
  }
}

export function proposalTargetsFeature(
  proposal: CadAgentProposal,
  featureId: string
): boolean {
  return proposal.transaction.commands.some((command) => {
    if ('featureId' in command) return command.featureId === featureId
    if (command.type === 'feature.create') return command.feature.id === featureId
    if ('sketchId' in command) return command.sketchId === featureId
    return false
  })
}

export function proposalFeature(
  proposal: CadAgentProposal,
  document: CadDocument
): CadFeature | undefined {
  const command = [...proposal.transaction.commands]
    .reverse()
    .find((item) => item.type === 'feature.create')
  return command?.type === 'feature.create'
    ? command.feature
    : document.features.find((feature) =>
        proposalTargetsFeature(proposal, feature.id)
      )
}
