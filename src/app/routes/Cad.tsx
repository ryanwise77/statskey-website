import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CadViewport,
  type CadMeasurement,
  type CadViewportHandle,
} from '../components/cad/CadViewport'
import { proposeCadAgentAction } from '../lib/cad/agent'
import {
  CadCommandError,
  cadDocumentFingerprint,
  cadId,
  createCadDocument,
  createCadTransaction,
  createCircleEntity,
  createLineEntity,
  createMountingPlateTransaction,
  createRectangleEntity,
  createSketchFeature,
  decodeCadDocument,
  replayCadHistory,
  serializeCadDocument,
} from '../lib/cad/document'
import {
  exportBinaryStl,
  exportFacetedStep,
  safeCadFileName,
  validateBinaryStl,
  validateFacetedStep,
} from '../lib/cad/exports'
import {
  executeCadTransaction,
  loadCadSession,
  redoCadSession,
  replaceCadDocument,
  saveCadSession,
  selectCadFeature,
  undoCadSession,
} from '../lib/cad/session'
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
  CadId,
  CadSessionState,
  CadSketchEntity,
  CadSketchFeature,
  CadTransaction,
} from '../lib/cad/types'
import { useCadBuild } from '../lib/cad/useCadBuild'
import './Cad.css'

type SketchTool = 'line' | 'rectangle' | 'circle'
type ExportStatus = {
  tone: 'success' | 'error'
  message: string
} | null

function activeSketch(document: CadDocument): CadSketchFeature | undefined {
  return [...document.features]
    .reverse()
    .find(
      (feature): feature is CadSketchFeature =>
        feature.kind === 'sketch' && !feature.suppressed
    )
}

function liveExtrudes(document: CadDocument): CadExtrudeFeature[] {
  const extrudes = document.features.filter(
    (feature): feature is CadExtrudeFeature =>
      feature.kind === 'extrude' && !feature.suppressed
  )
  const consumed = new Set(
    document.features
      .filter(
        (feature): feature is CadBooleanFeature =>
          feature.kind === 'boolean' && !feature.suppressed
      )
      .map((feature) => feature.toolBodyId)
  )
  return extrudes.filter((feature) => !consumed.has(feature.bodyId))
}

function activeBody(document: CadDocument): CadExtrudeFeature | undefined {
  return liveExtrudes(document).at(-1)
}

function featureGlyph(feature: CadFeature): string {
  switch (feature.kind) {
    case 'sketch':
      return '◇'
    case 'extrude':
      return '▣'
    case 'hole':
      return '◉'
    case 'fillet':
      return '⌒'
    case 'chamfer':
      return '◢'
    case 'boolean':
      return feature.operation === 'union' ? '∪' : '−'
  }
}

function featureLabel(feature: CadFeature): string {
  switch (feature.kind) {
    case 'sketch':
      return 'Sketch'
    case 'extrude':
      return 'Extrude'
    case 'hole':
      return 'Hole'
    case 'fillet':
      return 'Fillet'
    case 'chamfer':
      return 'Chamfer'
    case 'boolean':
      return 'Boolean'
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function inputTarget(event: KeyboardEvent): boolean {
  const target = event.target
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}

export function Cad() {
  const [session, setSession] = useState<CadSessionState>(() =>
    loadCadSession()
  )
  const [documentNameDraft, setDocumentNameDraft] = useState(
    session.present.name
  )
  const [proposal, setProposal] = useState<CadAgentProposal | null>(null)
  const [agentPrompt, setAgentPrompt] = useState(
    'Create a 100 × 60 × 8 mm mounting plate with four 6 mm through-holes, each centered 8 mm from its two nearest edges, and 4 mm corner fillets.'
  )
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(
    null
  )
  const [exportStatus, setExportStatus] = useState<ExportStatus>(null)
  const [measureMode, setMeasureMode] = useState(false)
  const [measurement, setMeasurement] = useState<CadMeasurement | null>(null)
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [snapSize, setSnapSize] = useState(1)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const viewportRef = useRef<CadViewportHandle | null>(null)
  const sessionRef = useRef(session)
  sessionRef.current = session

  const displayDocument = proposal?.previewDocument ?? session.present
  const build = useCadBuild(displayDocument)
  const canExport =
    !proposal &&
    !build.loading &&
    build.result?.ok === true &&
    build.result.documentRevision === session.present.revision &&
    Boolean(build.result.mesh && build.result.metrics)
  const selectedFeature = session.present.features.find(
    (feature) => feature.id === session.selectedFeatureId
  )
  useEffect(() => {
    setDocumentNameDraft(session.present.name)
  }, [session.present.name])
  const statusByFeature = useMemo(
    () =>
      new Map(
        (build.result?.statuses ?? []).map((status) => [
          status.featureId,
          status,
        ])
      ),
    [build.result?.statuses]
  )

  const commitSession = useCallback((next: CadSessionState) => {
    try {
      const persistence = saveCadSession(next)
      setPersistenceWarning(persistence.warning ?? null)
    } catch (error) {
      setPersistenceWarning(
        error instanceof Error
          ? `The current model remains open, but autosave failed: ${error.message}`
          : 'The current model remains open, but autosave failed.'
      )
    }
    sessionRef.current = next
    setSession(next)
  }, [])

  const execute = useCallback(
    (transaction: CadTransaction): boolean => {
      try {
        const next = executeCadTransaction(sessionRef.current, transaction)
        commitSession(next)
        setProposal(null)
        setWorkspaceError(null)
        setExportStatus(null)
        return true
      } catch (error) {
        setWorkspaceError(
          error instanceof CadCommandError || error instanceof Error
            ? error.message
            : 'The model operation could not be completed.'
        )
        return false
      }
    },
    [commitSession]
  )

  const selectFeature = useCallback(
    (featureId: CadId | null) => {
      const next = selectCadFeature(sessionRef.current, featureId)
      commitSession(next)
    },
    [commitSession]
  )

  const undo = useCallback(() => {
    const current = sessionRef.current
    const next = undoCadSession(current)
    if (next === current) return
    setProposal(null)
    setWorkspaceError(null)
    commitSession(next)
  }, [commitSession])

  const redo = useCallback(() => {
    const current = sessionRef.current
    const next = redoCadSession(current)
    if (next === current) return
    setProposal(null)
    setWorkspaceError(null)
    commitSession(next)
  }, [commitSession])

  const deleteSelected = useCallback(() => {
    const featureId = sessionRef.current.selectedFeatureId
    if (!featureId) return
    execute(
      createCadTransaction('Delete feature', 'manual', [
        { type: 'feature.delete', featureId, cascade: true },
      ])
    )
  }, [execute])

  const toggleSelectedSuppression = useCallback(() => {
    const feature = sessionRef.current.present.features.find(
      (item) => item.id === sessionRef.current.selectedFeatureId
    )
    if (!feature) return
    execute(
      createCadTransaction(
        `${feature.suppressed ? 'Enable' : 'Suppress'} ${feature.name}`,
        'manual',
        [
          {
            type: 'feature.suppress',
            featureId: feature.id,
            suppressed: !feature.suppressed,
          },
        ]
      )
    )
  }, [execute])

  const addSketch = useCallback(() => {
    const sketch = createSketchFeature(
      `Sketch ${sessionRef.current.present.features.filter((feature) => feature.kind === 'sketch').length + 1}`,
      'manual'
    )
    execute(
      createCadTransaction('Create sketch', 'manual', [
        { type: 'feature.create', feature: sketch },
      ])
    )
  }, [execute])

  const addSketchEntity = useCallback(
    (tool: SketchTool) => {
      const document = sessionRef.current.present
      let sketch = activeSketch(document)
      const commands: CadCommand[] = []
      if (!sketch) {
        sketch = createSketchFeature('Sketch 1', 'manual')
        commands.push({ type: 'feature.create', feature: sketch })
      }
      const created =
        tool === 'line'
          ? createLineEntity()
          : tool === 'rectangle'
            ? createRectangleEntity()
            : createCircleEntity()
      commands.push({
        type: 'sketch.entity.create',
        sketchId: sketch.id,
        entity: created.entity,
        constraints: created.constraints,
      })
      execute(
        createCadTransaction(`Add ${tool}`, 'manual', commands)
      )
    },
    [execute]
  )

  const addExtrude = useCallback(() => {
    const document = sessionRef.current.present
    const sketch = activeSketch(document)
    if (!sketch) {
      setWorkspaceError('Create a sketch with a closed profile before extruding.')
      return
    }
    const feature: CadExtrudeFeature = {
      id: cadId('feature'),
      kind: 'extrude',
      name: 'Extrude 8 mm',
      origin: 'manual',
      suppressed: false,
      profileId: sketch.id,
      bodyId: cadId('body'),
      distance: 8,
      direction: 'normal',
      operation: 'new',
    }
    execute(
      createCadTransaction('Extrude sketch', 'manual', [
        { type: 'feature.create', feature },
      ])
    )
  }, [execute])

  const addHoles = useCallback(() => {
    const document = sessionRef.current.present
    const body = activeBody(document)
    if (!body) {
      setWorkspaceError('Create a solid body before adding through-holes.')
      return
    }
    const feature: CadHoleFeature = {
      id: cadId('feature'),
      kind: 'hole',
      name: '4 × Ø6 mm through-holes',
      origin: 'manual',
      suppressed: false,
      bodyId: body.bodyId,
      profileId: body.profileId,
      placement: {
        kind: 'rectangular-edge-pattern',
        edgeOffset: 8,
        diameter: 6,
      },
      termination: 'through-all',
    }
    execute(
      createCadTransaction('Add through-holes', 'manual', [
        { type: 'feature.create', feature },
      ])
    )
  }, [execute])

  const addFillet = useCallback(() => {
    const body = activeBody(sessionRef.current.present)
    if (!body) {
      setWorkspaceError('Create a solid body before adding a fillet.')
      return
    }
    const feature: CadFilletFeature = {
      id: cadId('feature'),
      kind: 'fillet',
      name: 'Corner fillet R4 mm',
      origin: 'manual',
      suppressed: false,
      bodyId: body.bodyId,
      profileId: body.profileId,
      radius: 4,
      selection: 'outer-vertical-edges',
    }
    execute(
      createCadTransaction('Add corner fillet', 'manual', [
        { type: 'feature.create', feature },
      ])
    )
  }, [execute])

  const addChamfer = useCallback(() => {
    const body = activeBody(sessionRef.current.present)
    if (!body) {
      setWorkspaceError('Create a solid body before adding a chamfer.')
      return
    }
    const feature: CadChamferFeature = {
      id: cadId('feature'),
      kind: 'chamfer',
      name: 'Corner chamfer 4 mm',
      origin: 'manual',
      suppressed: false,
      bodyId: body.bodyId,
      profileId: body.profileId,
      distance: 4,
      selection: 'outer-vertical-edges',
    }
    execute(
      createCadTransaction('Add corner chamfer', 'manual', [
        { type: 'feature.create', feature },
      ])
    )
  }, [execute])

  const addBoolean = useCallback(
    (operation: 'union' | 'subtract') => {
      const bodies = liveExtrudes(sessionRef.current.present)
      if (bodies.length < 2) {
        setWorkspaceError(
          'Boolean operations need two unsuppressed solid bodies. Create and extrude a second sketch first.'
        )
        return
      }
      const [target, tool] = bodies.slice(-2)
      const feature: CadBooleanFeature = {
        id: cadId('feature'),
        kind: 'boolean',
        name: `Boolean ${operation}`,
        origin: 'manual',
        suppressed: false,
        bodyId: target.bodyId,
        toolBodyId: tool.bodyId,
        operation,
      }
      execute(
        createCadTransaction(`Boolean ${operation}`, 'manual', [
          { type: 'feature.create', feature },
        ])
      )
    },
    [execute]
  )

  const addMountingPlate = useCallback(() => {
    execute(createMountingPlateTransaction('manual'))
  }, [execute])

  const createNewDocument = useCallback(() => {
    if (
      sessionRef.current.present.features.length > 0 &&
      !window.confirm(
        'Start a new model? The current model is autosaved and remains available through Undo until this workspace is closed.'
      )
    ) {
      return
    }
    const next = replaceCadDocument(
      sessionRef.current,
      createCadDocument('Untitled model')
    )
    setProposal(null)
    setWorkspaceError(null)
    commitSession(next)
  }, [commitSession])

  const saveParametricDocument = useCallback(() => {
    try {
      const serialized = serializeCadDocument(sessionRef.current.present)
      downloadBlob(
        new Blob([serialized], { type: 'application/json' }),
        `${safeCadFileName(sessionRef.current.present.name)}.statscad`
      )
      setExportStatus({
        tone: 'success',
        message: 'Parametric document saved with feature and command history.',
      })
    } catch (error) {
      setExportStatus({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'The model could not be saved.',
      })
    }
  }, [])

  const openParametricDocument = useCallback(
    async (file: File) => {
      try {
        const document = decodeCadDocument(await file.text())
        const next = replaceCadDocument(sessionRef.current, document)
        setProposal(null)
        setWorkspaceError(null)
        commitSession(next)
        setExportStatus({
          tone: 'success',
          message: `Opened ${file.name}; all editable features and history were restored.`,
        })
      } catch (error) {
        setExportStatus({
          tone: 'error',
          message:
            error instanceof Error
              ? error.message
              : 'The selected document could not be opened.',
        })
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [commitSession]
  )

  const exportModel = useCallback(
    (format: 'STL' | 'STEP') => {
      const result = build.result
      const mesh = result?.mesh
      if (
        !canExport ||
        !mesh ||
        !result?.metrics ||
        result.documentRevision !== sessionRef.current.present.revision
      ) {
        setExportStatus({
          tone: 'error',
          message:
            'Finish the current preview and wait for a successful model rebuild before exporting.',
        })
        return
      }
      const expected: [number, number, number] = [
        ...result.metrics.bounds.size,
      ]
      const baseName = safeCadFileName(sessionRef.current.present.name)
      try {
        if (format === 'STL') {
          const buffer = exportBinaryStl(mesh, sessionRef.current.present.name)
          const validation = validateBinaryStl(buffer, expected)
          if (!validation.valid) throw new Error(validation.errors.join(' '))
          downloadBlob(
            new Blob([buffer], { type: 'model/stl' }),
            `${baseName}.stl`
          )
          setExportStatus({
            tone: 'success',
            message: `STL validated: ${validation.triangleCount.toLocaleString()} triangles · ${validation.bounds?.size.map((value) => value.toFixed(2)).join(' × ')} mm.`,
          })
        } else {
          const step = exportFacetedStep(
            mesh,
            sessionRef.current.present.name,
            new Date(sessionRef.current.present.updatedAt)
          )
          const validation = validateFacetedStep(step, expected)
          if (!validation.valid) throw new Error(validation.errors.join(' '))
          downloadBlob(
            new Blob([step], { type: 'model/step' }),
            `${baseName}.step`
          )
          setExportStatus({
            tone: 'success',
            message: `STEP validated: closed faceted B-Rep · ${validation.triangleCount.toLocaleString()} faces · ${validation.bounds?.size.map((value) => value.toFixed(2)).join(' × ')} mm.`,
          })
        }
      } catch (error) {
        setExportStatus({
          tone: 'error',
          message:
            error instanceof Error
              ? `${format} export failed validation: ${error.message}`
              : `${format} export failed validation.`,
        })
      }
    },
    [build.result, canExport]
  )

  const previewAgentPlan = useCallback(() => {
    const nextProposal = proposeCadAgentAction(
      sessionRef.current.present,
      agentPrompt
    )
    setProposal(nextProposal)
    setWorkspaceError(null)
  }, [agentPrompt])

  const executeAgentPlan = useCallback(() => {
    if (!proposal || proposal.error) return
    if (
      cadDocumentFingerprint(sessionRef.current.present) !==
      proposal.baseFingerprint
    ) {
      setWorkspaceError(
        'The model changed after this plan was previewed. Preview it again before execution.'
      )
      setProposal(null)
      return
    }
    if (execute(proposal.transaction)) setProposal(null)
  }, [execute, proposal])

  const replayHistory = useCallback(
    (recordId: CadId) => {
      try {
        const replayed = replayCadHistory(
          sessionRef.current.present,
          recordId
        )
        const next = replaceCadDocument(sessionRef.current, replayed)
        setProposal(null)
        setWorkspaceError(null)
        commitSession(next)
      } catch (error) {
        setWorkspaceError(
          error instanceof Error
            ? error.message
            : 'The selected history state could not be replayed.'
        )
      }
    },
    [commitSession]
  )

  const commitFeatureCommand = useCallback(
    (label: string, command: CadCommand) => {
      execute(createCadTransaction(label, 'manual', [command]))
    },
    [execute]
  )

  useEffect(() => {
    const handleKeyboard = (event: KeyboardEvent) => {
      if (inputTarget(event)) return
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelected()
        return
      }
      if (event.key === 'Escape') {
        setProposal(null)
        setMeasureMode(false)
        viewportRef.current?.clearMeasurement()
        return
      }
      switch (event.key.toLowerCase()) {
        case 'f':
          viewportRef.current?.fitView()
          break
        case 'm':
          setMeasureMode((current) => !current)
          break
        case 's':
          toggleSelectedSuppression()
          break
        case 'l':
          addSketchEntity('line')
          break
        case 'r':
          addSketchEntity('rectangle')
          break
        case 'c':
          addSketchEntity('circle')
          break
        case 'e':
          addExtrude()
          break
      }
    }
    window.addEventListener('keydown', handleKeyboard)
    return () => window.removeEventListener('keydown', handleKeyboard)
  }, [
    addExtrude,
    addSketchEntity,
    deleteSelected,
    redo,
    toggleSelectedSuppression,
    undo,
  ])

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (!event.key?.startsWith('statskey.cad.')) return
      const restored = loadCadSession()
      if (restored.present.updatedAt > sessionRef.current.present.updatedAt) {
        setProposal(null)
        setWorkspaceError(null)
        sessionRef.current = restored
        setSession(restored)
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const lastSolidFeature = [...session.present.features]
    .reverse()
    .find((feature) => feature.kind !== 'sketch')
  const metrics = build.result?.metrics
  const displayedErrors = [
    ...(workspaceError ? [workspaceError] : []),
    ...(build.result?.errors ?? []),
  ]

  return (
    <div className="cad-workspace">
      <header className="cad-header">
        <div className="cad-document-identity">
          <div className="cad-mark" aria-hidden="true">
            SK
          </div>
          <div>
            <input
              className="cad-document-name"
              value={documentNameDraft}
              aria-label="Model name"
              onChange={(event) => setDocumentNameDraft(event.target.value)}
              onBlur={(event) => {
                const name = event.target.value.trim() || 'Untitled model'
                if (name === sessionRef.current.present.name) {
                  setDocumentNameDraft(name)
                  return
                }
                commitFeatureCommand('Rename model', {
                  type: 'document.rename',
                  name,
                })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') {
                  setDocumentNameDraft(sessionRef.current.present.name)
                  event.currentTarget.blur()
                }
              }}
            />
            <span className="cad-save-state">
              Autosaved locally · revision {session.present.revision}
            </span>
          </div>
        </div>
        <div className="cad-header-actions">
          <button type="button" onClick={createNewDocument}>
            New
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Open
          </button>
          <button type="button" onClick={saveParametricDocument}>
            Save .statscad
          </button>
          <span className="cad-header-separator" />
          <button
            type="button"
            disabled={!canExport}
            onClick={() => exportModel('STEP')}
          >
            Export STEP
          </button>
          <button
            type="button"
            disabled={!canExport}
            onClick={() => exportModel('STL')}
          >
            Export STL
          </button>
          <input
            ref={fileInputRef}
            hidden
            type="file"
            accept=".statscad,application/json"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void openParametricDocument(file)
            }}
          />
        </div>
      </header>

      <div className="cad-toolbar" aria-label="CAD modeling toolbar">
        <ToolButton label="New sketch" shortcut="K" glyph="◇" onClick={addSketch} />
        <div className="cad-tool-divider" />
        <ToolButton
          label="Line"
          shortcut="L"
          glyph="╱"
          onClick={() => addSketchEntity('line')}
        />
        <ToolButton
          label="Rectangle"
          shortcut="R"
          glyph="□"
          onClick={() => addSketchEntity('rectangle')}
        />
        <ToolButton
          label="Circle"
          shortcut="C"
          glyph="○"
          onClick={() => addSketchEntity('circle')}
        />
        <div className="cad-tool-divider" />
        <ToolButton label="Extrude" shortcut="E" glyph="▣" onClick={addExtrude} />
        <ToolButton label="Through-holes" glyph="◉" onClick={addHoles} />
        <ToolButton label="Fillet" glyph="⌒" onClick={addFillet} />
        <ToolButton label="Chamfer" glyph="◢" onClick={addChamfer} />
        <ToolButton
          label="Union"
          glyph="∪"
          onClick={() => addBoolean('union')}
        />
        <ToolButton
          label="Subtract"
          glyph="−"
          onClick={() => addBoolean('subtract')}
        />
        <div className="cad-tool-spacer" />
        <button
          type="button"
          className="cad-acceptance-tool"
          onClick={addMountingPlate}
        >
          <span aria-hidden="true">✦</span>
          Mounting plate
        </button>
        <div className="cad-tool-divider" />
        <ToolButton
          label="Undo"
          shortcut="⌘Z"
          glyph="↶"
          disabled={session.past.length === 0}
          onClick={undo}
        />
        <ToolButton
          label="Redo"
          shortcut="⇧⌘Z"
          glyph="↷"
          disabled={session.future.length === 0}
          onClick={redo}
        />
      </div>

      <main className="cad-main">
        <aside className="cad-feature-panel">
          <div className="cad-panel-heading">
            <div>
              <span className="cad-eyebrow">Model</span>
              <h2>Feature tree</h2>
            </div>
            <span className="cad-feature-count">
              {session.present.features.length}
            </span>
          </div>
          <div className="cad-origin-row">
            <span className="cad-origin-axis x">X</span>
            <span className="cad-origin-axis y">Y</span>
            <span className="cad-origin-axis z">Z</span>
            <span>Origin · XY plane</span>
          </div>
          <div className="cad-feature-list">
            {session.present.features.length === 0 ? (
              <div className="cad-empty-tree">
                <span className="cad-empty-tree-glyph">◇</span>
                <strong>No features yet</strong>
                <p>
                  Start manually or preview the mounting plate with the agent.
                </p>
              </div>
            ) : (
              session.present.features.map((feature, index) => {
                const status = statusByFeature.get(feature.id)
                const selected = feature.id === session.selectedFeatureId
                return (
                  <div
                    key={feature.id}
                    className={`cad-feature-row${selected ? ' is-selected' : ''}${feature.suppressed ? ' is-suppressed' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectFeature(feature.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        selectFeature(feature.id)
                      }
                    }}
                  >
                    <span className="cad-tree-rail" aria-hidden="true">
                      {index === session.present.features.length - 1 ? '└' : '├'}
                    </span>
                    <span className="cad-feature-glyph" aria-hidden="true">
                      {featureGlyph(feature)}
                    </span>
                    <span className="cad-feature-copy">
                      <strong>{feature.name}</strong>
                      <small>
                        {featureLabel(feature)}
                        {feature.origin === 'agent' ? ' · agent' : ''}
                      </small>
                    </span>
                    <span
                      className={`cad-feature-status ${status?.state ?? (feature.suppressed ? 'suppressed' : 'pending')}`}
                      title={status?.message}
                    />
                    <button
                      type="button"
                      className="cad-row-action"
                      title={feature.suppressed ? 'Enable feature' : 'Suppress feature'}
                      aria-label={
                        feature.suppressed ? 'Enable feature' : 'Suppress feature'
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        commitFeatureCommand(
                          `${feature.suppressed ? 'Enable' : 'Suppress'} ${feature.name}`,
                          {
                            type: 'feature.suppress',
                            featureId: feature.id,
                            suppressed: !feature.suppressed,
                          }
                        )
                      }}
                    >
                      {feature.suppressed ? '○' : '●'}
                    </button>
                  </div>
                )
              })
            )}
          </div>
          <div className="cad-history-summary">
            <span className="cad-eyebrow">Command history</span>
            {session.present.commandLog.slice(-5).reverse().map((record) => (
              <div className="cad-history-record" key={record.id}>
                <span>{record.origin === 'agent' ? '✦' : '•'}</span>
                <div>
                  <strong>{record.label}</strong>
                  <small>
                    {record.commandCount} command
                    {record.commandCount === 1 ? '' : 's'} ·{' '}
                    {record.afterFingerprint}
                  </small>
                </div>
                <button
                  type="button"
                  className="cad-history-replay"
                  onClick={() => replayHistory(record.id)}
                  title={`Replay through ${record.label}`}
                  aria-label={`Replay through ${record.label}`}
                >
                  ↻
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="cad-stage">
          <div className="cad-viewport-tools">
            <button
              type="button"
              className={measureMode ? 'is-active' : ''}
              onClick={() => {
                setMeasureMode((current) => !current)
                setMeasurement(null)
                viewportRef.current?.clearMeasurement()
              }}
            >
              ⟷ Measure <kbd>M</kbd>
            </button>
            <label>
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(event) => setSnapEnabled(event.target.checked)}
              />
              Snap
            </label>
            <select
              aria-label="Snap spacing"
              value={snapSize}
              onChange={(event) => setSnapSize(Number(event.target.value))}
            >
              <option value={0.5}>0.5 mm</option>
              <option value={1}>1 mm</option>
              <option value={5}>5 mm</option>
              <option value={10}>10 mm</option>
            </select>
            <button
              type="button"
              onClick={() => viewportRef.current?.fitView()}
            >
              Fit <kbd>F</kbd>
            </button>
          </div>
          <CadViewport
            ref={viewportRef}
            result={build.result}
            preview={Boolean(proposal?.previewDocument)}
            selected={Boolean(selectedFeature && selectedFeature.kind !== 'sketch')}
            measureMode={measureMode}
            snapEnabled={snapEnabled}
            snapSize={snapSize}
            onSelectModel={() =>
              selectFeature(lastSolidFeature?.id ?? session.present.features.at(-1)?.id ?? null)
            }
            onMeasure={setMeasurement}
          />
          <div className="cad-orientation-cube" aria-hidden="true">
            <span className="top">TOP</span>
            <span className="front">FRONT</span>
            <span className="right">RIGHT</span>
          </div>
          {proposal?.previewDocument && (
            <div className="cad-preview-banner">
              <span>PREVIEW</span>
              Proposed geometry · not executed
            </div>
          )}
          {build.loading && (
            <div className="cad-rebuild-indicator">
              <span className="cad-spinner" />
              Rebuilding revision {displayDocument.revision}
            </div>
          )}
          {measurement && (
            <div className="cad-measurement-readout">
              <span>Measured distance</span>
              <strong>{measurement.distance.toFixed(3)} mm</strong>
              <small>
                ΔX {(measurement.end[0] - measurement.start[0]).toFixed(2)} · ΔY{' '}
                {(measurement.end[1] - measurement.start[1]).toFixed(2)} · ΔZ{' '}
                {(measurement.end[2] - measurement.start[2]).toFixed(2)}
              </small>
            </div>
          )}
          {displayedErrors.length > 0 && (
            <div className="cad-error-stack" role="alert">
              {displayedErrors.map((message, index) => (
                <div key={`${message}-${index}`}>
                  <strong>Rebuild needs attention</strong>
                  <span>{message}</span>
                </div>
              ))}
            </div>
          )}
          <div className="cad-stage-status">
            <span>
              {metrics
                ? `${metrics.bounds.size.map((value) => value.toFixed(2)).join(' × ')} mm`
                : 'No solid body'}
            </span>
            <span>
              {metrics
                ? `${metrics.triangleCount.toLocaleString()} triangles`
                : 'Ready'}
            </span>
            <span>
              {metrics ? `${metrics.volume.toFixed(2)} mm³` : 'Units · mm'}
            </span>
            <span className={build.result?.ok ? 'is-healthy' : ''}>
              {build.result?.ok ? '✓ Deterministic rebuild' : 'Awaiting rebuild'}
            </span>
          </div>
        </section>

        <aside className="cad-right-panel">
          <section className="cad-inspector">
            <div className="cad-panel-heading">
              <div>
                <span className="cad-eyebrow">Properties</span>
                <h2>Inspector</h2>
              </div>
              {selectedFeature && (
                <span className="cad-kind-pill">
                  {featureLabel(selectedFeature)}
                </span>
              )}
            </div>
            {selectedFeature ? (
              <FeatureInspector
                key={selectedFeature.id}
                feature={selectedFeature}
                document={session.present}
                status={statusByFeature.get(selectedFeature.id)?.message}
                onCommand={commitFeatureCommand}
                onDelete={deleteSelected}
              />
            ) : (
              <div className="cad-empty-inspector">
                Select a feature to inspect and edit every driving parameter.
              </div>
            )}
          </section>

          <section className="cad-agent-panel">
            <div className="cad-agent-heading">
              <div className="cad-agent-orb" aria-hidden="true">
                ✦
              </div>
              <div>
                <span className="cad-eyebrow">Trustworthy modeling</span>
                <h2>CAD agent</h2>
              </div>
              <span className="cad-local-pill">Local plan</span>
            </div>
            <textarea
              value={agentPrompt}
              onChange={(event) => setAgentPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  previewAgentPlan()
                }
              }}
              placeholder="Describe a part or revise a parameter…"
              aria-label="CAD agent instruction"
            />
            <div className="cad-agent-suggestions">
              {[
                'Make the plate 20 mm wider',
                'Move the holes 3 mm inward',
                'Set the fillet radius to 6 mm',
              ].map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => setAgentPrompt(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="cad-preview-plan-button"
              onClick={previewAgentPlan}
            >
              Preview feature plan
              <kbd>⌘↵</kbd>
            </button>
            {proposal && (
              <div
                className={`cad-proposal${proposal.error ? ' has-error' : ''}`}
              >
                <div className="cad-proposal-title">
                  <span>{proposal.error ? '!' : '✦'}</span>
                  <div>
                    <small>
                      {proposal.error ? 'Plan blocked' : 'Proposed transaction'}
                    </small>
                    <strong>{proposal.title}</strong>
                  </div>
                </div>
                {proposal.error ? (
                  <p className="cad-proposal-error">{proposal.error}</p>
                ) : (
                  <>
                    <p>{proposal.explanation}</p>
                    <ol>
                      {proposal.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ol>
                    {proposal.warnings.map((warning) => (
                      <div className="cad-proposal-warning" key={warning}>
                        {warning}
                      </div>
                    ))}
                    <div className="cad-proposal-proof">
                      <span>Same command pipeline</span>
                      <span>Undoable</span>
                      <span>Editable</span>
                    </div>
                  </>
                )}
                <div className="cad-proposal-actions">
                  <button
                    type="button"
                    onClick={() => setProposal(null)}
                  >
                    Cancel
                  </button>
                  {!proposal.error && (
                    <button
                      type="button"
                      className="primary"
                      disabled={build.loading || build.result?.ok === false}
                      onClick={executeAgentPlan}
                    >
                      Execute plan
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>
        </aside>
      </main>

      {(persistenceWarning || exportStatus) && (
        <div
          className={`cad-toast ${exportStatus?.tone ?? 'warning'}`}
          role="status"
        >
          <span>
            {exportStatus?.tone === 'success' ? '✓' : exportStatus ? '!' : '⚠'}
          </span>
          {exportStatus?.message ?? persistenceWarning}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              setExportStatus(null)
              setPersistenceWarning(null)
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

function ToolButton({
  label,
  glyph,
  shortcut,
  disabled,
  onClick,
}: {
  label: string
  glyph: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className="cad-tool-button"
      disabled={disabled}
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <span aria-hidden="true">{glyph}</span>
      <small>{label}</small>
    </button>
  )
}

function NumberField({
  label,
  value,
  unit = 'mm',
  step = 0.5,
  onCommit,
}: {
  label: string
  value: number
  unit?: string
  step?: number
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  return (
    <label className="cad-field">
      <span>{label}</span>
      <span className="cad-number-input">
        <input
          type="number"
          value={draft}
          step={step}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraft(String(value))
              event.currentTarget.blur()
            }
          }}
          onBlur={() => {
            const next = Number(draft)
            if (Number.isFinite(next) && next !== value) onCommit(next)
            else setDraft(String(value))
          }}
        />
        <em>{unit}</em>
      </span>
    </label>
  )
}

function FeatureInspector({
  feature,
  document,
  status,
  onCommand,
  onDelete,
}: {
  feature: CadFeature
  document: CadDocument
  status?: string
  onCommand: (label: string, command: CadCommand) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(feature.name)
  const rename = () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === feature.name) {
      setName(feature.name)
      return
    }
    onCommand(`Rename ${feature.name}`, {
      type: 'feature.update',
      featureId: feature.id,
      changes: { kind: feature.kind, name: trimmed } as never,
    })
  }
  return (
    <div className="cad-inspector-content">
      <label className="cad-field">
        <span>Name</span>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={rename}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
        />
      </label>
      <div className="cad-inspector-meta">
        <span>{feature.origin === 'agent' ? '✦ Agent feature' : 'Manual feature'}</span>
        <span>{feature.id.split(':').at(-1)?.slice(0, 8)}</span>
      </div>
      {feature.kind === 'sketch' && (
        <SketchInspector
          feature={feature}
          onCommand={onCommand}
        />
      )}
      {feature.kind === 'extrude' && (
        <NumberField
          label="Distance"
          value={feature.distance}
          onCommit={(distance) =>
            onCommand('Change extrude distance', {
              type: 'feature.update',
              featureId: feature.id,
              changes: { kind: 'extrude', distance },
            })
          }
        />
      )}
      {feature.kind === 'hole' && (
        <>
          <NumberField
            label="Diameter"
            value={feature.placement.diameter}
            onCommit={(diameter) =>
              onCommand('Change hole diameter', {
                type: 'feature.update',
                featureId: feature.id,
                changes: { kind: 'hole', diameter },
              })
            }
          />
          {feature.placement.kind === 'rectangular-edge-pattern' && (
            <NumberField
              label="Edge offset"
              value={feature.placement.edgeOffset}
              onCommit={(edgeOffset) =>
                onCommand('Change hole edge offset', {
                  type: 'feature.update',
                  featureId: feature.id,
                  changes: { kind: 'hole', edgeOffset },
                })
              }
            />
          )}
          <div className="cad-readonly-field">
            <span>Termination</span>
            <strong>Through all</strong>
          </div>
        </>
      )}
      {feature.kind === 'fillet' && (
        <NumberField
          label="Radius"
          value={feature.radius}
          onCommit={(radius) =>
            onCommand('Change fillet radius', {
              type: 'feature.update',
              featureId: feature.id,
              changes: { kind: 'fillet', radius },
            })
          }
        />
      )}
      {feature.kind === 'chamfer' && (
        <NumberField
          label="Distance"
          value={feature.distance}
          onCommit={(distance) =>
            onCommand('Change chamfer distance', {
              type: 'feature.update',
              featureId: feature.id,
              changes: { kind: 'chamfer', distance },
            })
          }
        />
      )}
      {feature.kind === 'boolean' && (
        <>
          <label className="cad-field">
            <span>Operation</span>
            <select
              value={feature.operation}
              onChange={(event) =>
                onCommand('Change boolean operation', {
                  type: 'feature.update',
                  featureId: feature.id,
                  changes: {
                    kind: 'boolean',
                    operation: event.target.value as 'union' | 'subtract',
                  },
                })
              }
            >
              <option value="union">Union</option>
              <option value="subtract">Subtract</option>
            </select>
          </label>
          <div className="cad-readonly-field">
            <span>Tool body</span>
            <strong>
              {document.features.find(
                (item) =>
                  item.kind === 'extrude' &&
                  item.bodyId === feature.toolBodyId
              )?.name ?? feature.toolBodyId}
            </strong>
          </div>
        </>
      )}
      <div className="cad-selection-field">
        <span>Selection</span>
        <strong>
          {feature.kind === 'fillet' || feature.kind === 'chamfer'
            ? '4 outer vertical edges'
            : feature.kind === 'sketch'
              ? 'XY plane'
              : feature.kind === 'hole'
                ? 'Target body'
                : feature.kind === 'extrude'
                  ? 'Closed sketch regions'
                  : '2 solid bodies'}
        </strong>
      </div>
      {status && <div className="cad-feature-proof">✓ {status}</div>}
      <div className="cad-inspector-actions">
        <button
          type="button"
          onClick={() =>
            onCommand(
              `${feature.suppressed ? 'Enable' : 'Suppress'} ${feature.name}`,
              {
                type: 'feature.suppress',
                featureId: feature.id,
                suppressed: !feature.suppressed,
              }
            )
          }
        >
          {feature.suppressed ? 'Enable' : 'Suppress'}
        </button>
        <button type="button" className="danger" onClick={onDelete}>
          Delete
        </button>
      </div>
    </div>
  )
}

function SketchInspector({
  feature,
  onCommand,
}: {
  feature: CadSketchFeature
  onCommand: (label: string, command: CadCommand) => void
}) {
  return (
    <>
      <div className="cad-inspector-section-title">
        Driving dimensions
        <span>{feature.constraints.length}</span>
      </div>
      {feature.constraints.map((constraint) => (
        <NumberField
          key={constraint.id}
          label={constraint.label}
          value={constraint.value}
          onCommit={(value) =>
            onCommand(`Change ${constraint.label}`, {
              type: 'sketch.constraint.update',
              sketchId: feature.id,
              constraintId: constraint.id,
              value,
            })
          }
        />
      ))}
      <div className="cad-inspector-section-title">
        Geometry
        <span>{feature.entities.length}</span>
      </div>
      {feature.entities.map((entity) => (
        <SketchEntityEditor
          key={entity.id}
          sketch={feature}
          entity={entity}
          onCommand={onCommand}
        />
      ))}
    </>
  )
}

function SketchEntityEditor({
  sketch,
  entity,
  onCommand,
}: {
  sketch: CadSketchFeature
  entity: CadSketchEntity
  onCommand: (label: string, command: CadCommand) => void
}) {
  return (
    <div className="cad-entity-card">
      <div>
        <span>{entity.kind === 'line' ? '╱' : entity.kind === 'rectangle' ? '□' : '○'}</span>
        <strong>{entity.name}</strong>
        <small>{entity.id.split(':').at(-1)?.slice(0, 6)}</small>
      </div>
      {(entity.kind === 'rectangle' || entity.kind === 'circle') && (
        <div className="cad-coordinate-grid">
          <NumberField
            label="Center X"
            value={entity.center.x}
            onCommit={(x) =>
              onCommand(`Move ${entity.name}`, {
                type: 'sketch.entity.update',
                sketchId: sketch.id,
                entityId: entity.id,
                changes: { center: { ...entity.center, x } },
              })
            }
          />
          <NumberField
            label="Center Y"
            value={entity.center.y}
            onCommit={(y) =>
              onCommand(`Move ${entity.name}`, {
                type: 'sketch.entity.update',
                sketchId: sketch.id,
                entityId: entity.id,
                changes: { center: { ...entity.center, y } },
              })
            }
          />
        </div>
      )}
      {entity.kind === 'line' && (
        <div className="cad-coordinate-grid">
          {(
            [
              ['Start X', 'start', 'x'],
              ['Start Y', 'start', 'y'],
              ['End X', 'end', 'x'],
              ['End Y', 'end', 'y'],
            ] as const
          ).map(([label, point, axis]) => (
            <NumberField
              key={label}
              label={label}
              value={entity[point][axis]}
              onCommit={(value) =>
                onCommand(`Edit ${entity.name}`, {
                  type: 'sketch.entity.update',
                  sketchId: sketch.id,
                  entityId: entity.id,
                  changes: {
                    [point]: { ...entity[point], [axis]: value },
                  },
                })
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}
