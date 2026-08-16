import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  getDesktopBridge,
  type DesktopProviderId,
  type DesktopProviderStatus,
} from '../lib/desktop'
import { confirmDialog } from '../lib/ui/dialogs'

interface ProviderDefinition {
  id: DesktopProviderId
  name: string
  description: string
  helpUrl?: string
  fields: Array<{
    id: string
    label: string
    placeholder?: string
    secret?: boolean
    required?: boolean
  }>
}

const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude, including Fable, Opus, and Sonnet.',
    helpUrl: 'https://console.anthropic.com/settings/keys',
    fields: [
      { id: 'apiKey', label: 'API key', secret: true, required: true },
    ],
  },
  {
    id: 'openai',
    name: 'ChatGPT',
    description: 'GPT-5.6 and other models available to your account.',
    helpUrl: 'https://platform.openai.com/api-keys',
    fields: [
      { id: 'apiKey', label: 'API key', secret: true, required: true },
      { id: 'organization', label: 'Organization ID', placeholder: 'Optional' },
      { id: 'project', label: 'Project ID', placeholder: 'Optional' },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    description: 'Gemini models available through Google’s developer API.',
    helpUrl: 'https://aistudio.google.com/apikey',
    fields: [
      { id: 'apiKey', label: 'API key', secret: true, required: true },
    ],
  },
  {
    id: 'xai',
    name: 'Grok',
    description: 'Grok models available to your xAI account.',
    helpUrl: 'https://console.x.ai/',
    fields: [
      { id: 'apiKey', label: 'API key', secret: true, required: true },
    ],
  },
  {
    id: 'moonshot',
    name: 'Kimi by Moonshot',
    description: 'Kimi K3 and newer models returned by your Moonshot account.',
    helpUrl: 'https://platform.moonshot.ai/console/api-keys',
    fields: [
      { id: 'apiKey', label: 'API key', secret: true, required: true },
    ],
  },
  {
    id: 'azure-openai',
    name: 'Azure models',
    description: 'Use an existing Azure model deployment.',
    helpUrl: 'https://portal.azure.com/',
    fields: [
      { id: 'apiKey', label: 'API key', secret: true, required: true },
      {
        id: 'endpoint',
        label: 'Resource endpoint',
        placeholder: 'https://your-resource.openai.azure.com',
        required: true,
      },
      { id: 'deployment', label: 'Deployment name', required: true },
      { id: 'apiVersion', label: 'API version', placeholder: '2026-06-01' },
    ],
  },
  {
    id: 'aws-bedrock',
    name: 'AWS Bedrock',
    description: 'Use models and permissions from your AWS account.',
    helpUrl: 'https://console.aws.amazon.com/iam/',
    fields: [
      { id: 'accessKeyId', label: 'Access key ID', secret: true, required: true },
      { id: 'secretAccessKey', label: 'Secret access key', secret: true, required: true },
      { id: 'sessionToken', label: 'Session token', secret: true, placeholder: 'Optional' },
      { id: 'region', label: 'Region', placeholder: 'us-east-1', required: true },
      {
        id: 'model',
        label: 'Model or inference profile ID',
        placeholder: 'us.anthropic.claude-sonnet-5-v1:0',
        required: true,
      },
    ],
  },
  {
    id: 'openai-compatible',
    name: 'Compatible endpoint',
    description: 'Connect any OpenAI-compatible chat provider or local server.',
    fields: [
      { id: 'baseUrl', label: 'Base URL', placeholder: 'http://localhost:11434/v1', required: true },
      { id: 'model', label: 'Model ID', required: true },
      { id: 'apiKey', label: 'API key', secret: true, placeholder: 'Optional' },
    ],
  },
]

export function ModelProviders({ embedded = false }: { embedded?: boolean }) {
  const bridge = getDesktopBridge()
  const [statuses, setStatuses] = useState<DesktopProviderStatus[]>([])
  const [openProvider, setOpenProvider] = useState<DesktopProviderId | null>(null)
  const [message, setMessage] = useState<{ provider: DesktopProviderId; text: string; error?: boolean } | null>(null)
  const [inlineCompletions, setInlineCompletions] = useState(
    () => localStorage.getItem('statskey.desktop.inline-completions') === 'true'
  )

  async function refresh() {
    if (!bridge) return
    setStatuses(await bridge.providers.getStatus())
  }

  useEffect(() => {
    void refresh()
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    bridge.preferences
      .get()
      .then((preferences) =>
        setInlineCompletions(preferences.inlineCompletions)
      )
      .catch(() => {})
  }, [bridge])

  const statusByProvider = useMemo(
    () => new Map(statuses.map((status) => [status.provider, status])),
    [statuses]
  )
  const hasConfiguredProvider = statuses.some((status) => status.configured)
  const setupGuide = (
    <section className="provider-setup-guide">
      <header>
        <span>Recommended setup</span>
        <b>Four steps, once per computer</b>
      </header>
      <ol>
        <li>
          <span>1</span>
          <div>
            <b>Create a provider key</b>
            <small>Choose Anthropic, ChatGPT, Gemini, Grok, Kimi, Azure, or Bedrock below.</small>
          </div>
        </li>
        <li>
          <span>2</span>
          <div>
            <b>Paste and save it here</b>
            <small>The operating system encrypts it immediately.</small>
          </div>
        </li>
        <li>
          <span>3</span>
          <div>
            <b>Test the connection</b>
            <small>StatsKey verifies access without revealing the key again.</small>
          </div>
        </li>
        <li>
          <span>4</span>
          <div>
            <b>Select “My key” in Ask StatsKey</b>
            <small>Pick the exact model, effort, and context budget.</small>
          </div>
        </li>
      </ol>
      <p>
        Keys remain on this computer. They are never synchronized to the mobile
        app or browser, so mobile use cannot spend your provider balance.
      </p>
    </section>
  )

  if (!bridge) {
    return (
      <div className="provider-settings__unavailable">
        Provider keys are available only in the StatsKey desktop app.
      </div>
    )
  }

  return (
    <div className="provider-settings">
      {!embedded && (
      <header className="provider-settings__header">
        <div>
          <span>Local provider access</span>
          <h1>Use your own model accounts</h1>
          <p>
            Credentials are encrypted by this computer’s operating system. Direct
            requests go from this desktop app to the provider you choose—not through
            StatsKey’s managed model service.
          </p>
        </div>
        <div className="provider-settings__security">
          <span aria-hidden="true">⌁</span>
          <div>
            <b>OS-encrypted vault</b>
            <small>Keys are never shown again after saving.</small>
          </div>
        </div>
      </header>
      )}

      {hasConfiguredProvider ? (
        <details className="provider-setup-disclosure">
          <summary>
            <span>Setup guide</span>
            <small>Four steps for adding another provider</small>
          </summary>
          {setupGuide}
        </details>
      ) : (
        setupGuide
      )}

      <label className="provider-settings__toggle">
        <input
          type="checkbox"
          checked={inlineCompletions}
          onChange={(event) => {
            const enabled = event.target.checked
            setInlineCompletions(enabled)
            if (bridge) {
              void bridge.preferences.save({ inlineCompletions: enabled })
            } else {
              localStorage.setItem(
                'statskey.desktop.inline-completions',
                String(enabled)
              )
            }
          }}
        />
        <span>
          <b>Local inline completions</b>
          <small>
            Suggest code in the workspace editor using the direct model selected in
            Ask StatsKey. Provider charges apply.
          </small>
        </span>
      </label>

      <section className="provider-settings__list">
        {PROVIDERS.map((provider) => {
          const status = statusByProvider.get(provider.id)
          const open = openProvider === provider.id
          return (
            <article
              key={provider.id}
              className={`provider-card${
                status?.configured ? ' provider-card--configured' : ''
              }${open ? ' provider-card--open' : ''}`}
            >
              <header>
                <div className="provider-card__identity">
                  <ProviderMark name={provider.name} />
                  <div>
                    <b>{provider.name}</b>
                    <p>{provider.description}</p>
                  </div>
                </div>
                <div className="provider-card__status">
                  <span>{status?.configured ? 'Connected' : 'Not connected'}</span>
                  <button
                    type="button"
                    onClick={() => setOpenProvider(open ? null : provider.id)}
                    aria-expanded={open}
                    aria-controls={`provider-form-${provider.id}`}
                  >
                    {open ? 'Close' : status?.configured ? 'Manage' : 'Connect'}
                  </button>
                </div>
              </header>

              {open && (
                <ProviderForm
                  id={`provider-form-${provider.id}`}
                  provider={provider}
                  status={status}
                  message={message?.provider === provider.id ? message : null}
                  onSaved={async (text) => {
                    setMessage({ provider: provider.id, text })
                    await refresh()
                  }}
                  onError={(text) =>
                    setMessage({ provider: provider.id, text, error: true })
                  }
                  onRemoved={async () => {
                    setMessage({ provider: provider.id, text: 'Credentials removed.' })
                    await refresh()
                  }}
                />
              )}
            </article>
          )
        })}
      </section>

      <p className="provider-settings__footnote">
        Your provider’s retention and billing terms apply to direct requests. StatsKey
        does not proxy or meter them.
      </p>
    </div>
  )
}

function ProviderForm({
  id,
  provider,
  status,
  message,
  onSaved,
  onError,
  onRemoved,
}: {
  id: string
  provider: ProviderDefinition
  status?: DesktopProviderStatus
  message: { text: string; error?: boolean } | null
  onSaved: (message: string) => void
  onError: (message: string) => void
  onRemoved: () => void
}) {
  const bridge = getDesktopBridge()
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...status?.config,
  }))
  const [busy, setBusy] = useState<'save' | 'test' | 'remove' | null>(null)

  useEffect(() => {
    setValues((current) => ({ ...status?.config, ...current }))
  }, [status])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!bridge) return
    setBusy('save')
    try {
      const result = await bridge.providers.save(provider.id, values)
      if (!result.ok) throw new Error(result.error || 'Could not save credentials.')
      setValues((current) => {
        const next = { ...current }
        for (const field of provider.fields) {
          if (field.secret) next[field.id] = ''
        }
        return next
      })
      onSaved('Saved securely.')
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function test() {
    if (!bridge) return
    setBusy('test')
    try {
      const result = await bridge.providers.test(provider.id)
      if (!result.ok) throw new Error(result.error || 'Connection failed.')
      onSaved(result.message || 'Connection verified.')
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  async function remove() {
    if (!bridge) return
    const confirmed = await confirmDialog({
      title: `Remove ${provider.name} credentials?`,
      body: 'The stored key is deleted from this computer.',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    setBusy('remove')
    try {
      await bridge.providers.remove(provider.id)
      setValues({})
      onRemoved()
    } finally {
      setBusy(null)
    }
  }

  return (
    <form
      id={id}
      className="provider-form"
      onSubmit={save}
      aria-busy={busy != null}
    >
      {provider.helpUrl && (
        <a
          className="provider-form__help"
          href={provider.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open {provider.name} key setup ↗
        </a>
      )}
      <div className="provider-form__fields">
        {provider.fields.map((field, index) => {
          const stored = field.secret && status?.credentials[field.id]
          return (
            <label key={field.id}>
              <span>
                {field.label}
                {field.required && !stored ? <i>required</i> : null}
              </span>
              <input
                type={field.secret ? 'password' : 'text'}
                value={values[field.id] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    [field.id]: event.target.value,
                  }))
                }
                placeholder={
                  stored
                    ? 'Stored securely · enter a new value to replace'
                    : field.placeholder
                }
                autoComplete="off"
                spellCheck={false}
                autoFocus={index === 0}
              />
            </label>
          )
        })}
      </div>

      {message && (
        <div
          className={
            message.error
              ? 'provider-form__message error'
              : 'provider-form__message'
          }
          role={message.error ? 'alert' : 'status'}
        >
          {message.text}
        </div>
      )}

      <footer>
        <button className="btn btn-primary" type="submit" disabled={busy != null}>
          {busy === 'save' ? 'Saving…' : 'Save securely'}
        </button>
        {status?.configured && (
          <>
            <button className="btn btn-secondary" type="button" onClick={test} disabled={busy != null}>
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </button>
            <button className="provider-form__remove" type="button" onClick={remove} disabled={busy != null}>
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          </>
        )}
      </footer>
    </form>
  )
}

function ProviderMark({ name }: { name: string }) {
  return (
    <span className="provider-card__mark" aria-hidden="true">
      {name
        .split(/\s+/)
        .map((part) => part[0])
        .join('')
        .slice(0, 2)}
    </span>
  )
}
