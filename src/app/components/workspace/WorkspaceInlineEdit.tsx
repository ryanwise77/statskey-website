import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CHAT_MODELS, type ReasoningEffort } from '../../lib/ai/providers'
import {
  getDesktopBridge,
  type DesktopProviderId,
} from '../../lib/desktop'
import { Markdown } from '../Markdown'
import type { WorkspaceInlineSelection } from './MonacoWorkspaceEditor'
import './WorkspaceInlineEdit.css'

export interface WorkspaceInlineEditRequest extends WorkspaceInlineSelection {
  source: string
}

const MODEL_KEY_ERROR =
  'Choose My key in model settings before using inline edit.'

export function WorkspaceInlineEdit({
  request,
  currentSource,
  fileName,
  language,
  onApply,
  onClose,
  onEscalate,
}: {
  request: WorkspaceInlineEditRequest
  currentSource: string
  fileName: string
  language: string
  onApply: (replacement: string) => void
  onClose: () => void
  onEscalate: (prompt: string) => void
}) {
  const navigate = useNavigate()
  const [instruction, setInstruction] = useState('')
  const [mode, setMode] = useState<'edit' | 'question'>('edit')
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const sourceChanged = currentSource !== request.source
  const diff = useMemo(
    () =>
      mode === 'edit' && result !== null
        ? diffLines(request.selectedText, result)
        : [],
    [mode, request.selectedText, result]
  )

  useEffect(() => {
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const requestId = requestIdRef.current
      if (requestId) getDesktopBridge()?.providers.cancel(requestId)
    }
  }, [onClose])

  async function run(nextMode: 'edit' | 'question') {
    const prompt = instruction.trim()
    if (!prompt || loading) return
    const bridge = getDesktopBridge()
    if (!bridge) return
    const preference = await getDirectWorkspaceModelPreference()
    if (!preference) {
      setError(MODEL_KEY_ERROR)
      return
    }
    setMode(nextMode)
    setLoading(true)
    setResult(null)
    setError(null)
    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    const before = request.source.slice(
      Math.max(0, request.startOffset - 8_000),
      request.startOffset
    )
    const after = request.source.slice(
      request.endOffset,
      request.endOffset + 8_000
    )
    try {
      const response = await bridge.providers.run(
        requestId,
        preference.provider,
        {
          model: preference.modelId,
          systemPrompt:
            nextMode === 'edit'
              ? 'Replace only the selected file region according to the instruction. Return only the exact replacement text with no Markdown fence or explanation. Preserve indentation, style, surrounding contracts, and unrelated behavior.'
              : 'Answer the question about the selected code precisely and concisely. Do not propose unrelated changes.',
          messages: [
            {
              role: 'user',
              content: [
                `File: ${fileName}`,
                `Language: ${language}`,
                `Instruction: ${prompt}`,
                `<before_selection>\n${before}\n</before_selection>`,
                `<selection>\n${request.selectedText}\n</selection>`,
                `<after_selection>\n${after}\n</after_selection>`,
              ].join('\n\n'),
            },
          ],
          effort: preference.effort,
          reasoningMode: 'standard',
          maxOutputTokens: nextMode === 'edit' ? 8_000 : 3_000,
          webSearch: false,
        }
      )
      setResult(
        nextMode === 'edit'
          ? cleanReplacement(response.content)
          : response.content.trim()
      )
    } catch (runError) {
      setError(
        runError instanceof Error
          ? runError.message
          : 'Inline edit could not finish.'
      )
    } finally {
      requestIdRef.current = null
      setLoading(false)
    }
  }

  function sendToAgent() {
    const prompt = [
      instruction.trim() || 'Review and improve this selection.',
      `File: ${fileName}`,
      `Lines: ${request.startLine}-${request.endLine}`,
      '<selection>',
      request.selectedText.slice(0, 16_000),
      '</selection>',
    ].join('\n')
    onEscalate(prompt)
  }

  return (
    <aside className="workspace-inline-edit" aria-label="Inline edit">
      <header>
        <div>
          <b>Inline edit</b>
          <span>
            {fileName} · lines {request.startLine}–{request.endLine}
          </span>
        </div>
        <button onClick={onClose} aria-label="Close inline edit">
          ×
        </button>
      </header>
      <div className="workspace-inline-edit__prompt">
        <input
          ref={inputRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            void run(event.altKey ? 'question' : 'edit')
          }}
          placeholder="Describe the change…"
          aria-label="Inline edit instruction"
        />
        <button
          className="primary"
          disabled={!instruction.trim() || loading}
          onClick={() => void run('edit')}
        >
          {loading && mode === 'edit' ? 'Editing…' : 'Preview edit'}
        </button>
        <button
          disabled={!instruction.trim() || loading}
          onClick={() => void run('question')}
          title="Ask about this selection · ⌥Enter"
        >
          Ask
        </button>
      </div>
      {error && (
        <p className="workspace-inline-edit__error">
          <span>{error}</span>
          {error === MODEL_KEY_ERROR && (
            <button
              type="button"
              className="workspace-inline-edit__error-action"
              onClick={() => navigate('/models')}
            >
              Open model settings
            </button>
          )}
        </p>
      )}
      {sourceChanged && (
        <p className="workspace-inline-edit__warning">
          The file changed after this selection. Close and reopen inline edit
          before applying a replacement.
        </p>
      )}
      {result !== null && mode === 'question' && (
        <div className="workspace-inline-edit__answer">
          <Markdown text={result} />
        </div>
      )}
      {result !== null && mode === 'edit' && (
        <div className="workspace-inline-edit__preview">
          <div className="workspace-inline-edit__diff">
            <header>
              <b>Review replacement</b>
              <span>
                {lineCount(request.selectedText)} → {lineCount(result)} lines
              </span>
            </header>
            <pre aria-label="Proposed replacement diff">
              {diff.length === 0 ? (
                <span className="workspace-inline-edit__diff-line workspace-inline-edit__diff-line--context">
                  <i aria-hidden="true"> </i>(no lines)
                </span>
              ) : (
                diff.map((line, index) => (
                  <span
                    key={index}
                    className={`workspace-inline-edit__diff-line workspace-inline-edit__diff-line--${line.kind}`}
                  >
                    <i aria-hidden="true">
                      {line.kind === 'add'
                        ? '+'
                        : line.kind === 'remove'
                          ? '−'
                          : ' '}
                    </i>
                    {line.text || ' '}
                  </span>
                ))
              )}
            </pre>
          </div>
          <button
            className="primary"
            disabled={sourceChanged}
            onClick={() => onApply(result)}
          >
            Apply
          </button>
          <button onClick={() => setResult(null)}>Discard</button>
        </div>
      )}
      <footer>
        <span>Enter previews · ⌥Enter asks · Esc closes</span>
        <button onClick={sendToAgent}>Continue in Intelligence</button>
      </footer>
    </aside>
  )
}

export async function getDirectWorkspaceModelPreference(): Promise<{
  provider: DesktopProviderId
  modelId: string
  effort: ReasoningEffort
} | null> {
  const bridge = getDesktopBridge()
  if (!bridge) return null
  const preferences = await bridge.preferences.get()
  const stored = preferences.modelSettings
  if (
    stored == null ||
    stored.executionRoute !== 'direct' ||
    typeof stored.modelLabel !== 'string'
  ) {
    return null
  }
  const known = CHAT_MODELS.find(
    (candidate) => candidate.label === stored.modelLabel
  )
  const provider = known?.directProvider ?? stored.directProvider
  const modelId = known?.modelId ?? stored.modelId
  if (!isDesktopProviderId(provider) || typeof modelId !== 'string') {
    return null
  }
  const effort = isReasoningEffort(stored.effort)
    ? stored.effort
    : known?.defaultEffort ?? 'medium'
  return { provider, modelId, effort }
}

function cleanReplacement(value: string): string {
  return value
    .trimEnd()
    .replace(/^```[a-z0-9_-]*\n/i, '')
    .replace(/\n```$/, '')
}

export interface InlineDiffLine {
  kind: 'context' | 'add' | 'remove'
  text: string
}

const MAX_DIFF_LINES = 400

/**
 * Minimal LCS line diff for the inline-edit review. Falls back to a plain
 * remove-all/add-all listing for very large selections.
 */
export function diffLines(before: string, after: string): InlineDiffLine[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    return [
      ...a.map((text) => ({ kind: 'remove' as const, text })),
      ...b.map((text) => ({ kind: 'add' as const, text })),
    ]
  }
  const cols = b.length + 1
  const table = new Uint32Array((a.length + 1) * cols)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i * cols + j] =
        a[i] === b[j]
          ? table[(i + 1) * cols + j + 1] + 1
          : Math.max(table[(i + 1) * cols + j], table[i * cols + j + 1])
    }
  }
  const lines: InlineDiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'context', text: a[i] })
      i++
      j++
    } else if (table[(i + 1) * cols + j] >= table[i * cols + j + 1]) {
      lines.push({ kind: 'remove', text: a[i] })
      i++
    } else {
      lines.push({ kind: 'add', text: b[j] })
      j++
    }
  }
  while (i < a.length) {
    lines.push({ kind: 'remove', text: a[i] })
    i++
  }
  while (j < b.length) {
    lines.push({ kind: 'add', text: b[j] })
    j++
  }
  return lines
}

function lineCount(value: string): number {
  return value ? value.split('\n').length : 0
}

function isDesktopProviderId(value: unknown): value is DesktopProviderId {
  return [
    'anthropic',
    'openai',
    'google',
    'xai',
    'moonshot',
    'azure-openai',
    'aws-bedrock',
    'openai-compatible',
  ].includes(String(value))
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(
    String(value)
  )
}
