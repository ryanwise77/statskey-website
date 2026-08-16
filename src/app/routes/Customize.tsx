import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { IntelligenceConsentGate } from '../components/assistant/IntelligenceConsentGate'
import { LocalWorkIntelligenceGate } from '../components/assistant/LocalWorkIntelligenceGate'
import { useAuth } from '../lib/auth'
import {
  getDesktopBridge,
  type DesktopApprovalMode,
  type DesktopMcpTool,
  type DesktopWorkspaceInstructions,
} from '../lib/desktop'
import { Flow } from './Flow'

type CustomizeSection = 'rules' | 'skills' | 'hooks' | 'mcp'
type DesktopBridge = NonNullable<ReturnType<typeof getDesktopBridge>>
type WorkspaceRule = DesktopWorkspaceInstructions['rules'][number]

const CUSTOMIZE_WORKBENCH_STYLES = `
  .customize-workbench {
    display: grid;
    grid-template-columns: minmax(0, 1fr) clamp(340px, 38vw, 620px);
    min-height: 100%;
  }

  .customize-workbench--embedded {
    display: block;
    min-height: 0;
  }

  .customize-workbench > .customize-page {
    min-width: 0;
  }

  .customize-workbench__intelligence {
    position: sticky;
    top: 0;
    display: flex;
    min-width: 0;
    height: 100vh;
    min-height: 0;
    overflow: hidden;
    border-left: 1px solid rgba(127, 127, 127, 0.22);
  }

  .customize-workbench__intelligence > * {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .customize-rule-editor article.is-editing {
    border-color: rgba(99, 102, 241, 0.58);
  }

  .customize-rule-editor__surface {
    display: grid;
    gap: 12px;
    margin-top: 14px;
  }

  .customize-rule-editor__textarea {
    box-sizing: border-box;
    width: 100%;
    min-height: 340px;
    resize: vertical;
    border: 1px solid rgba(127, 127, 127, 0.28);
    border-radius: 12px;
    background: rgba(17, 24, 39, 0.68);
    color: inherit;
    padding: 14px;
    font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    tab-size: 2;
  }

  .customize-rule-editor__textarea:focus {
    border-color: rgba(99, 102, 241, 0.78);
    outline: 2px solid rgba(99, 102, 241, 0.16);
    outline-offset: 1px;
  }

  .customize-rule-editor__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .customize-rule-editor__status {
    color: var(--text-secondary, #9ca3af);
    font-size: 12px;
  }

  .customize-rule-editor__actions {
    display: flex;
    gap: 8px;
  }

  @media (max-width: 900px) {
    .customize-workbench {
      grid-template-columns: minmax(0, 1fr);
    }

    .customize-workbench__intelligence {
      position: relative;
      height: min(72vh, 720px);
      border-top: 1px solid rgba(127, 127, 127, 0.22);
      border-left: 0;
    }
  }
`

const BUILT_IN_CONTROL_CAPABILITIES = [
  {
    id: 'builtin:controlled-browser',
    title: 'Controlled browser',
    subtitle: 'Built in · follows your review setting',
    detail:
      'Visible isolated browser with page reading and opaque element references. Password fields, downloads, permissions, popups, and private-network destinations remain blocked even when review prompts are disabled.',
  },
  {
    id: 'builtin:applications',
    title: 'Application launch',
    subtitle: 'Built in · follows your review setting',
    detail:
      'Lists and opens ordinary applications according to your review setting. Credential, terminal, system-control, wallet, and banking applications remain excluded.',
  },
]

export function Customize({ embedded = false }: { embedded?: boolean }) {
  const bridge = getDesktopBridge()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [section, setSection] = useState<CustomizeSection>('rules')
  const [instructions, setInstructions] =
    useState<DesktopWorkspaceInstructions | null>(null)
  const [mcpTools, setMcpTools] = useState<DesktopMcpTool[] | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [approvalMode, setApprovalMode] =
    useState<DesktopApprovalMode>('review')

  useEffect(() => {
    if (!bridge) {
      setLoading(false)
      return
    }
    bridge.workspace
      .instructions()
      .then(setInstructions)
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not inspect workspace customization.'
        )
      )
      .finally(() => setLoading(false))
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    void bridge.preferences
      .get()
      .then((preferences) => setApprovalMode(preferences.approvalMode))
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    const updateWorkspaceState = (
      state: Awaited<ReturnType<DesktopBridge['workspace']['getState']>>
    ) => {
      setWorkspaceOpen(state.roots.length > 0 || state.looseFiles.length > 0)
    }
    void bridge.workspace.getState().then(updateWorkspaceState)
    return bridge.workspace.onState(updateWorkspaceState)
  }, [bridge])

  async function loadMcpTools() {
    if (!bridge) return
    setError(null)
    try {
      setMcpTools(await bridge.mcp.tools(approvalMode))
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load connected tools.'
      )
    }
  }

  if (!bridge) {
    return (
      <section className="customize-page customize-page--empty">
        <h1>Customize the local workspace.</h1>
        <p>Rules, skills, hooks, and connected tools are available in the desktop app.</p>
      </section>
    )
  }

  const intelligence = (
    <Flow embedded workspaceLabel="Workspace customization" />
  )

  return (
    <div
      className={`customize-workbench${
        embedded ? ' customize-workbench--embedded' : ''
      }`}
    >
      <style>{CUSTOMIZE_WORKBENCH_STYLES}</style>
      <section className="customize-page">
        {!embedded && (
        <header>
          <div>
            <span>Workspace behavior</span>
            <h1>Customize</h1>
            <p>
              Edit the workspace instructions that shape Intelligence while the
              conversation stays open beside you. Saves use the same desktop review
              boundary as every other workspace change.
            </p>
          </div>
          <div className="customize-page__header-actions">
            <button onClick={() => navigate('/workspace')}>← Back to workspace</button>
            <Link to="/models">Models & keys</Link>
          </div>
        </header>
        )}

        <nav aria-label="Customization sections">
          {(['rules', 'skills', 'hooks', 'mcp'] as const).map((item) => (
            <button
              key={item}
              className={section === item ? 'active' : ''}
              onClick={() => setSection(item)}
            >
              {item === 'mcp'
                ? 'Connected tools'
                : `${item[0].toUpperCase()}${item.slice(1)}`}
              <small>{sectionCount(item, instructions, mcpTools)}</small>
            </button>
          ))}
        </nav>

        {error && <div className="error-banner">{error}</div>}
        {loading ? (
          <div className="customize-page__empty">Reading workspace configuration…</div>
        ) : (
          <div className="customize-page__content">
            {section === 'rules' && (
              <EditableRuleList
                bridge={bridge}
                rules={instructions?.rules ?? []}
                empty={
                  workspaceOpen
                    ? 'No workspace rules were found.'
                    : 'Open a project to inspect its rules.'
                }
                onInstructionsChange={setInstructions}
                onError={setError}
              />
            )}
            {section === 'skills' && (
              <CustomizationList
                empty={
                  workspaceOpen
                    ? 'No workspace skills were found.'
                    : 'Open a project to inspect its skills.'
                }
                items={(instructions?.skills ?? []).map((skill) => ({
                  id: skill.relativePath,
                  title: skill.name,
                  subtitle: skill.relativePath,
                  detail: skill.description,
                }))}
              />
            )}
            {section === 'hooks' && (
              <CustomizationList
                empty={
                  workspaceOpen
                    ? 'No workspace hook configuration was found.'
                    : 'Open a project to inspect its hooks.'
                }
                items={(instructions?.configuration.hookFiles ?? []).map((file) => ({
                  id: file.path,
                  title: file.name,
                  subtitle: file.relativePath,
                  detail:
                    'Runs only through the workspace approval and timeout boundary.',
                  reveal: () => void bridge.workspace.reveal(file.path),
                }))}
              />
            )}
            {section === 'mcp' && (
              <>
                <div className="customize-page__mcp-header">
                  <div>
                    <b>Connected tools</b>
                    <span>
                      Loading tools may start configured local servers and will
                      follow your approval settings.
                    </span>
                  </div>
                  <button onClick={() => void loadMcpTools()}>
                    {mcpTools ? 'Refresh tools' : 'Load tools'}
                  </button>
                </div>
                <CustomizationList
                  empty={
                    mcpTools
                      ? 'No connected tools are available.'
                      : 'Load tools when you want to inspect configured servers.'
                  }
                  items={[
                    ...BUILT_IN_CONTROL_CAPABILITIES,
                    ...(mcpTools?.map((tool) => ({
                      id: `${tool.server || 'local'}:${tool.name}`,
                      title: tool.name,
                      subtitle: tool.server || 'Local server',
                      detail:
                        tool.description ||
                        (tool.unavailable
                          ? 'Server unavailable'
                          : 'Connected tool'),
                    })) ??
                      (instructions?.configuration.mcpFiles ?? []).map((file) => ({
                        id: file.path,
                        title: file.name,
                        subtitle: file.relativePath,
                        detail: 'Configured workspace connection.',
                        reveal: () => void bridge.workspace.reveal(file.path),
                      }))),
                  ]}
                />
              </>
            )}
          </div>
        )}
      </section>

      {!embedded && (
        <aside
          className="customize-workbench__intelligence"
          aria-label="Workspace Intelligence"
        >
          {user ? (
            <IntelligenceConsentGate>{intelligence}</IntelligenceConsentGate>
          ) : (
            <LocalWorkIntelligenceGate>{intelligence}</LocalWorkIntelligenceGate>
          )}
        </aside>
      )}
    </div>
  )
}

function EditableRuleList({
  bridge,
  rules,
  empty,
  onInstructionsChange,
  onError,
}: {
  bridge: DesktopBridge
  rules: WorkspaceRule[]
  empty: string
  onInstructionsChange: (instructions: DesktopWorkspaceInstructions) => void
  onError: (message: string | null) => void
}) {
  const [editingPath, setEditingPath] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [savedDraft, setSavedDraft] = useState('')
  const [loadingPath, setLoadingPath] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  async function editRule(rule: WorkspaceRule) {
    setLoadingPath(rule.path)
    setStatus(null)
    onError(null)
    try {
      const file = await bridge.workspace.readFile(rule.path)
      if (!file || file.content == null) {
        throw new Error('That workspace rule is unavailable or is not a readable text file.')
      }
      setEditingPath(rule.path)
      setDraft(file.content)
      setSavedDraft(file.content)
    } catch (readError) {
      onError(
        readError instanceof Error
          ? readError.message
          : 'Could not open the workspace rule.'
      )
    } finally {
      setLoadingPath(null)
    }
  }

  async function saveRule() {
    if (!editingPath || draft === savedDraft || saving) return
    setSaving(true)
    setStatus(null)
    onError(null)
    try {
      await bridge.workspace.writeFile(editingPath, draft)
      onInstructionsChange(await bridge.workspace.instructions())
      setSavedDraft(draft)
      setStatus('Saved to the workspace. The conversation remains open.')
    } catch (writeError) {
      onError(
        writeError instanceof Error
          ? writeError.message
          : 'Could not save the workspace rule.'
      )
    } finally {
      setSaving(false)
    }
  }

  if (rules.length === 0) {
    return <div className="customize-page__empty">{empty}</div>
  }

  return (
    <div className="customize-list customize-rule-editor">
      {rules.map((rule) => {
        const isEditing = editingPath === rule.path
        const isDirty = isEditing && draft !== savedDraft
        const nameParts = rule.name.split('/').filter(Boolean)
        const displayName = nameParts.at(-1) ?? rule.name
        const location = nameParts.length > 1 ? nameParts[0] : null
        const availability = rule.alwaysApply
          ? 'Always active'
          : rule.globs
            ? `Files: ${rule.globs}`
            : 'Available when relevant'
        return (
          <article key={rule.path} className={isEditing ? 'is-editing' : ''}>
            <header>
              <div>
                <b title={rule.name}>{displayName}</b>
                <span>
                  {[location, availability].filter(Boolean).join(' · ')}
                </span>
              </div>
              <div className="customize-rule-editor__actions">
                <button onClick={() => void bridge.workspace.reveal(rule.path)}>
                  Reveal
                </button>
                <button
                  onClick={() => void editRule(rule)}
                  disabled={loadingPath === rule.path}
                >
                  {loadingPath === rule.path
                    ? 'Opening…'
                    : isEditing
                      ? 'Reload'
                      : 'Edit'}
                </button>
              </div>
            </header>

            {isEditing ? (
              <div className="customize-rule-editor__surface">
                <textarea
                  className="customize-rule-editor__textarea"
                  aria-label={`Edit ${rule.name}`}
                  value={draft}
                  spellCheck={false}
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setStatus(null)
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
                      event.preventDefault()
                      void saveRule()
                    }
                  }}
                />
                <div className="customize-rule-editor__footer">
                  <span className="customize-rule-editor__status">
                    {status ??
                      (isDirty
                        ? 'Unsaved changes · press ⌘S or Ctrl+S to save'
                        : 'Editing the source file directly')}
                  </span>
                  <div className="customize-rule-editor__actions">
                    <button
                      onClick={() => {
                        setDraft(savedDraft)
                        setStatus(null)
                      }}
                      disabled={!isDirty || saving}
                    >
                      Revert
                    </button>
                    <button
                      onClick={() => void saveRule()}
                      disabled={!isDirty || saving}
                    >
                      {saving ? 'Saving…' : 'Save rule'}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <p>
                {rule.description?.trim() ||
                  'Open this rule to review and edit its full instructions.'}
              </p>
            )}
          </article>
        )
      })}
    </div>
  )
}

function CustomizationList({
  items,
  empty,
}: {
  items: Array<{
    id: string
    title: string
    subtitle: string
    detail: string
    reveal?: () => void
  }>
  empty: string
}) {
  if (items.length === 0) {
    return <div className="customize-page__empty">{empty}</div>
  }
  return (
    <div className="customize-list">
      {items.map((item) => (
        <article key={item.id}>
          <header>
            <div>
              <b>{item.title}</b>
              <span>{item.subtitle}</span>
            </div>
            {item.reveal && <button onClick={item.reveal}>Reveal</button>}
          </header>
          <p>{item.detail}</p>
        </article>
      ))}
    </div>
  )
}

function sectionCount(
  section: CustomizeSection,
  instructions: DesktopWorkspaceInstructions | null,
  tools: DesktopMcpTool[] | null
): number {
  if (!instructions) return 0
  if (section === 'rules') return instructions.rules.length
  if (section === 'skills') return instructions.skills.length
  if (section === 'hooks') return instructions.configuration.hookFiles.length
  return (
    BUILT_IN_CONTROL_CAPABILITIES.length +
    (tools?.length ?? instructions.configuration.mcpFiles.length)
  )
}
