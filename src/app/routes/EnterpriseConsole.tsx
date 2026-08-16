import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  addEnterpriseMember,
  createEnterpriseOrganization,
  createEnterpriseWorkspace,
  removeEnterpriseMember,
  updateEnterpriseMemberRole,
  updateEnterpriseWorkspacePolicy,
  useEnterpriseOrganizations,
  type EnterpriseOrganization,
  type EnterpriseProvider,
  type EnterpriseWorkspace,
} from '../lib/enterprise'
import { confirmDialog, promptDialog } from '../lib/ui/dialogs'

const ORGANIZATION_TYPES = [
  { value: 'provider', label: 'Healthcare provider' },
  { value: 'payer', label: 'Health plan or payer' },
  { value: 'employer', label: 'Employer health program' },
  { value: 'research', label: 'Research organization' },
  { value: 'other', label: 'Other organization' },
]

const PROVIDERS: Array<{ id: EnterpriseProvider; label: string }> = [
  { id: 'google', label: 'Google regulated route' },
  { id: 'anthropic', label: 'Anthropic regulated route' },
  { id: 'openai', label: 'OpenAI regulated route' },
  { id: 'xai', label: 'xAI regulated route' },
]

export function EnterpriseConsole() {
  const { user } = useAuth()
  const backendEnabled =
    import.meta.env.VITE_ENTERPRISE_BACKEND_ENABLED === 'true'
  const state = useEnterpriseOrganizations(user?.uid)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (
      state.organizations.length > 0 &&
      !state.organizations.some(
        (organization) => organization.id === selectedOrganizationId
      )
    ) {
      setSelectedOrganizationId(state.organizations[0].id)
    }
  }, [state.organizations, selectedOrganizationId])

  const organization = useMemo(
    () =>
      state.organizations.find(
        (candidate) => candidate.id === selectedOrganizationId
      ),
    [state.organizations, selectedOrganizationId]
  )

  useEffect(() => {
    if (
      organization?.workspaces.length &&
      !organization.workspaces.some(
        (workspace) => workspace.id === selectedWorkspaceId
      )
    ) {
      setSelectedWorkspaceId(organization.workspaces[0].id)
    }
  }, [organization, selectedWorkspaceId])

  const workspace = organization?.workspaces.find(
    (candidate) => candidate.id === selectedWorkspaceId
  )

  if (state.loading) {
    return <div className="panel text-text-secondary text-sm">Loading enterprise workspaces…</div>
  }

  return (
    <div className="enterprise-console">
      <header className="enterprise-console__header">
        <div>
          <span className="enterprise-eyebrow">StatsKey Enterprise</span>
          <h1>Healthcare Intelligence administration</h1>
          <p>
            Manage workspaces, provider policy, retention, approvals, and
            regulated-readiness gates without exposing clinical data here.
          </p>
        </div>
        <div className="enterprise-phi-lock">
          <span>PHI processing</span>
          <b>Locked</b>
          <small>Requires executed BAA chain and readiness approval</small>
        </div>
      </header>

      {!backendEnabled && (
        <div className="enterprise-private-notice">
          Enterprise administration is running as a private software preview.
          Server mutations and PHI remain disabled until tenancy testing,
          counsel review, and the regulated-readiness deployment gate are
          complete.
        </div>
      )}

      {state.organizations.length === 0 ? (
        <OrganizationSetup
          enabled={backendEnabled}
          onCreated={() => state.refresh()}
          onError={setError}
        />
      ) : (
        <div className="enterprise-console__grid">
          <aside className="enterprise-org-rail">
            <span className="enterprise-section-title">Organizations</span>
            {state.organizations.map((candidate) => (
              <button
                key={candidate.id}
                className={
                  candidate.id === organization?.id ? 'active' : undefined
                }
                onClick={() => setSelectedOrganizationId(candidate.id)}
              >
                <b>{candidate.name}</b>
                <small>{candidate.role}</small>
              </button>
            ))}
          </aside>

          <main className="enterprise-workspace-main">
            {organization && (
              <>
                <OrganizationSummary organization={organization} />
                <WorkspaceTabs
                  organization={organization}
                  selectedWorkspaceId={selectedWorkspaceId}
                  onSelect={setSelectedWorkspaceId}
                  onCreated={() => state.refresh()}
                  onError={setError}
                />
                {workspace && (
                  <WorkspacePolicyEditor
                    workspace={workspace}
                    onSaved={() => state.refresh()}
                    onError={setError}
                  />
                )}
                <OrganizationMembers
                  organization={organization}
                  onSaved={() => state.refresh()}
                  onError={setError}
                />
                <AuditTrail organization={organization} />
              </>
            )}
          </main>

          <aside className="enterprise-readiness">
            <span className="enterprise-section-title">Regulated readiness</span>
            <ReadinessItem label="Customer BAA" ready={false} />
            <ReadinessItem label="Google Cloud BAA" ready={false} />
            <ReadinessItem label="Model-provider BAA" ready={false} />
            <ReadinessItem label="Risk analysis" ready={false} />
            <ReadinessItem label="Incident exercise" ready={false} />
            <ReadinessItem label="Audit export" ready={false} />
            <p>
              The server will keep PHI disabled until these controls are
              represented by verified, server-owned readiness records.
            </p>
          </aside>
        </div>
      )}

      {(error || state.error) && (
        <div className="error-banner">{error || state.error}</div>
      )}
    </div>
  )
}

function OrganizationSetup({
  enabled,
  onCreated,
  onError,
}: {
  enabled: boolean
  onCreated: () => void
  onError: (message: string | null) => void
}) {
  const [name, setName] = useState('')
  const [organizationType, setOrganizationType] = useState('provider')
  const [complianceIntent, setComplianceIntent] =
    useState<'standard' | 'hipaa'>('hipaa')
  const [saving, setSaving] = useState(false)

  async function create() {
    if (!name.trim() || saving) return
    setSaving(true)
    onError(null)
    try {
      await createEnterpriseOrganization({
        name: name.trim(),
        organizationType,
        complianceIntent,
      })
      onCreated()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="enterprise-setup panel">
      <div>
        <span className="card-title">Create an enterprise organization</span>
        <p>
          This creates an administrative workspace only. PHI remains disabled.
        </p>
      </div>
      <label>
        Organization name
        <input
          className="input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Northstar Health"
        />
      </label>
      <label>
        Organization type
        <select
          className="input"
          value={organizationType}
          onChange={(event) => setOrganizationType(event.target.value)}
        >
          {ORGANIZATION_TYPES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Intended use</legend>
        <label>
          <input
            type="radio"
            name="compliance-intent"
            checked={complianceIntent === 'standard'}
            onChange={() => setComplianceIntent('standard')}
          />
          Standard enterprise workspace
        </label>
        <label>
          <input
            type="radio"
            name="compliance-intent"
            checked={complianceIntent === 'hipaa'}
            onChange={() => setComplianceIntent('hipaa')}
          />
          Prepare for a HIPAA-regulated workspace
        </label>
      </fieldset>
      <button
        className="btn btn-primary"
        onClick={create}
        disabled={!enabled || saving || !name.trim()}
      >
        {saving
          ? 'Creating…'
          : enabled
          ? 'Create organization'
          : 'Private setup not enabled'}
      </button>
    </section>
  )
}

function OrganizationSummary({
  organization,
}: {
  organization: EnterpriseOrganization
}) {
  return (
    <section className="enterprise-summary">
      <div>
        <span className="enterprise-section-title">Organization</span>
        <h2>{organization.name}</h2>
        <p>
          {organization.organizationType} · role: {organization.role}
        </p>
      </div>
      <div>
        <span>Compliance intent</span>
        <b>{organization.complianceIntent === 'hipaa' ? 'HIPAA readiness' : 'Standard'}</b>
      </div>
      <div>
        <span>Status</span>
        <b>{formatStatus(organization.complianceStatus)}</b>
      </div>
    </section>
  )
}

function WorkspaceTabs({
  organization,
  selectedWorkspaceId,
  onSelect,
  onCreated,
  onError,
}: {
  organization: EnterpriseOrganization
  selectedWorkspaceId: string
  onSelect: (id: string) => void
  onCreated: () => void
  onError: (message: string | null) => void
}) {
  const [creating, setCreating] = useState(false)

  async function create() {
    if (creating) return
    const name = await promptDialog({
      title: 'New workspace',
      label: 'Workspace name',
      confirmLabel: 'Create',
    })
    if (!name?.trim()) return
    setCreating(true)
    onError(null)
    try {
      await createEnterpriseWorkspace({
        organizationId: organization.id,
        name: name.trim(),
        complianceIntent: organization.complianceIntent,
      })
      onCreated()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="enterprise-workspace-tabs">
      {organization.workspaces.map((workspace) => (
        <button
          key={workspace.id}
          className={workspace.id === selectedWorkspaceId ? 'active' : undefined}
          onClick={() => onSelect(workspace.id)}
        >
          {workspace.name}
        </button>
      ))}
      {(organization.role === 'owner' || organization.role === 'admin') && (
        <button onClick={create} disabled={creating}>
          {creating ? 'Creating…' : '+ Workspace'}
        </button>
      )}
    </div>
  )
}

function WorkspacePolicyEditor({
  workspace,
  onSaved,
  onError,
}: {
  workspace: EnterpriseWorkspace
  onSaved: () => void
  onError: (message: string | null) => void
}) {
  const [retentionDays, setRetentionDays] = useState(workspace.policy.retentionDays)
  const [providers, setProviders] = useState<EnterpriseProvider[]>(
    workspace.policy.permittedProviders
  )
  const [webSearchEnabled, setWebSearchEnabled] = useState(
    workspace.policy.webSearchEnabled
  )
  const [exportEnabled, setExportEnabled] = useState(workspace.policy.exportEnabled)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setRetentionDays(workspace.policy.retentionDays)
    setProviders(workspace.policy.permittedProviders)
    setWebSearchEnabled(workspace.policy.webSearchEnabled)
    setExportEnabled(workspace.policy.exportEnabled)
  }, [workspace])

  function toggleProvider(provider: EnterpriseProvider) {
    setProviders((current) =>
      current.includes(provider)
        ? current.filter((candidate) => candidate !== provider)
        : [...current, provider].sort()
    )
  }

  async function save() {
    if (saving) return
    setSaving(true)
    onError(null)
    try {
      await updateEnterpriseWorkspacePolicy({
        organizationId: workspace.organizationId,
        workspaceId: workspace.id,
        retentionDays,
        permittedProviders: providers,
        webSearchEnabled,
        exportEnabled,
      })
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="enterprise-policy panel">
      <header>
        <div>
          <span className="enterprise-section-title">Workspace policy</span>
          <h2>{workspace.name}</h2>
        </div>
        <span className="enterprise-policy__lock">PHI disabled</span>
      </header>

      <div className="enterprise-policy__fixed">
        <span>External actions</span>
        <b>Exact approval always required</b>
      </div>

      <label>
        Retention period
        <select
          className="input"
          value={retentionDays}
          onChange={(event) => setRetentionDays(Number(event.target.value))}
        >
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>1 year</option>
          <option value={2190}>6 years</option>
          <option value={3650}>10 years</option>
        </select>
      </label>

      <fieldset>
        <legend>Permitted Intelligence providers for standard data</legend>
        {PROVIDERS.map((provider) => (
          <label key={provider.id}>
            <input
              type="checkbox"
              checked={providers.includes(provider.id)}
              onChange={() => toggleProvider(provider.id)}
            />
            {provider.label}
          </label>
        ))}
      </fieldset>

      <label className="enterprise-policy__check">
        <input
          type="checkbox"
          checked={webSearchEnabled}
          onChange={(event) => setWebSearchEnabled(event.target.checked)}
        />
        Enable external web search for standard data
      </label>
      <label className="enterprise-policy__check">
        <input
          type="checkbox"
          checked={exportEnabled}
          onChange={(event) => setExportEnabled(event.target.checked)}
        />
        Allow member-requested data export
      </label>

      <button className="btn btn-primary" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save policy'}
      </button>
    </section>
  )
}

function OrganizationMembers({
  organization,
  onSaved,
  onError,
}: {
  organization: EnterpriseOrganization
  onSaved: () => void
  onError: (message: string | null) => void
}) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'clinician' | 'analyst' | 'viewer'>(
    'viewer'
  )
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const canManage = organization.role === 'owner' || organization.role === 'admin'
  const assignableRoles =
    organization.role === 'owner'
      ? (['admin', 'clinician', 'analyst', 'viewer'] as const)
      : (['clinician', 'analyst', 'viewer'] as const)

  useEffect(() => {
    if (organization.role !== 'owner' && role === 'admin') setRole('viewer')
  }, [organization.role, role])

  async function add() {
    if (!email.trim() || busyUid || !canManage) return
    setBusyUid('new')
    onError(null)
    try {
      await addEnterpriseMember({
        organizationId: organization.id,
        email: email.trim(),
        role,
      })
      setEmail('')
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setBusyUid(null)
    }
  }

  async function changeRole(
    targetUid: string,
    nextRole: 'admin' | 'clinician' | 'analyst' | 'viewer'
  ) {
    setBusyUid(targetUid)
    onError(null)
    try {
      await updateEnterpriseMemberRole({
        organizationId: organization.id,
        targetUid,
        role: nextRole,
      })
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setBusyUid(null)
    }
  }

  async function remove(targetUid: string, label: string) {
    const confirmed = await confirmDialog({
      title: 'Remove member',
      body: `Remove ${label} from ${organization.name}?`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    setBusyUid(targetUid)
    onError(null)
    try {
      await removeEnterpriseMember({
        organizationId: organization.id,
        targetUid,
      })
      onSaved()
    } catch (error) {
      onError(messageFor(error))
    } finally {
      setBusyUid(null)
    }
  }

  return (
    <section className="enterprise-members panel">
      <header>
        <div>
          <span className="enterprise-section-title">Members and roles</span>
          <h2>Organization access</h2>
        </div>
        <span>{organization.members.length} members</span>
      </header>

      <div className="enterprise-members__list">
        {organization.members.map((member) => {
          const label = member.displayName || member.email || member.uid
          const editable =
            organization.role === 'owner' && member.role !== 'owner'
          const removable =
            member.role !== 'owner' &&
            (organization.role === 'owner' ||
              (organization.role === 'admin' && member.role !== 'admin'))
          return (
            <div key={member.uid}>
              <span>
                <b>{label}</b>
                {member.displayName && member.email && <small>{member.email}</small>}
              </span>
              {editable ? (
                <select
                  value={member.role}
                  disabled={busyUid === member.uid}
                  onChange={(event) =>
                    changeRole(
                      member.uid,
                      event.target.value as
                        | 'admin'
                        | 'clinician'
                        | 'analyst'
                        | 'viewer'
                    )
                  }
                >
                  {(['admin', 'clinician', 'analyst', 'viewer'] as const).map(
                    (candidate) => (
                      <option key={candidate} value={candidate}>
                        {candidate}
                      </option>
                    )
                  )}
                </select>
              ) : (
                <strong>{member.role}</strong>
              )}
              {removable && (
                <button
                  onClick={() => remove(member.uid, label)}
                  disabled={busyUid === member.uid}
                >
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>

      {canManage && (
        <div className="enterprise-members__add">
          <input
            className="input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Existing StatsKey account email"
          />
          <select
            className="input"
            value={role}
            onChange={(event) =>
              setRole(
                event.target.value as
                  | 'admin'
                  | 'clinician'
                  | 'analyst'
                  | 'viewer'
              )
            }
          >
            {assignableRoles.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
          <button
            className="btn btn-secondary"
            onClick={add}
            disabled={!email.trim() || busyUid != null}
          >
            {busyUid === 'new' ? 'Adding…' : 'Add member'}
          </button>
        </div>
      )}
      <p className="text-text-muted text-[11px]">
        Members must already have a StatsKey account. SSO and SCIM lifecycle
        management are required before regulated release.
      </p>
    </section>
  )
}

function AuditTrail({
  organization,
}: {
  organization: EnterpriseOrganization
}) {
  if (organization.role !== 'owner' && organization.role !== 'admin') return null
  return (
    <section className="enterprise-audit panel">
      <header>
        <div>
          <span className="enterprise-section-title">Server audit</span>
          <h2>Recent administrative events</h2>
        </div>
        <span>{organization.auditEvents.length} shown</span>
      </header>
      {organization.auditEvents.length === 0 ? (
        <p className="text-text-muted text-[11px]">
          No administrative events have been recorded yet.
        </p>
      ) : (
        <ol>
          {organization.auditEvents.map((event) => (
            <li key={event.id}>
              <span>
                <b>{event.summary}</b>
                <small>{event.type}</small>
              </span>
              <time dateTime={event.createdAt?.toISOString()}>
                {event.createdAt?.toLocaleString() ?? 'Pending timestamp'}
              </time>
            </li>
          ))}
        </ol>
      )}
      <p className="text-text-muted text-[11px]">
        These events are server-written. Immutable external export and SIEM
        streaming remain required for regulated release.
      </p>
    </section>
  )
}

function ReadinessItem({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div>
      <span>{label}</span>
      <b className={ready ? 'ready' : undefined}>{ready ? 'Verified' : 'Pending'}</b>
    </div>
  )
}

function formatStatus(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (character) => character.toUpperCase())
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
