import Editor, { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { CHAT_MODELS } from '../../lib/ai/providers'
import {
  getDesktopBridge,
  type DesktopProviderId,
} from '../../lib/desktop'

loader.config({ monaco })

export interface WorkspaceInlineSelection {
  startOffset: number
  endOffset: number
  selectedText: string
  startLine: number
  endLine: number
}

;(self as typeof self & {
  MonacoEnvironment?: {
    getWorker(_moduleId: string, label: string): Worker
  }
}).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') {
      return new htmlWorker()
    }
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

// Monaco inline-completions providers are global per language, not per editor,
// so register a single shared provider per language id and gate it on models
// that belong to a mounted MonacoWorkspaceEditor. This keeps split view (and
// multiple workspace surfaces) at one AI request per completion trigger.
const activeCompletionModels = new Map<monaco.editor.ITextModel, number>()
const completionProviderRegistrations = new Map<string, { dispose(): void }>()
let mountedWorkspaceEditorCount = 0

function retainCompletionModel(model: monaco.editor.ITextModel) {
  activeCompletionModels.set(model, (activeCompletionModels.get(model) ?? 0) + 1)
}

function releaseCompletionModel(model: monaco.editor.ITextModel) {
  const count = activeCompletionModels.get(model) ?? 0
  if (count <= 1) activeCompletionModels.delete(model)
  else activeCompletionModels.set(model, count - 1)
}

const inlineCompletionsProvider: monaco.languages.InlineCompletionsProvider = {
  provideInlineCompletions: async (
    model,
    position,
    _context,
    cancellationToken
  ) => {
    if (!activeCompletionModels.has(model)) return { items: [] }
    const bridge = getDesktopBridge()
    if (!bridge) return { items: [] }
    const preferences = await bridge.preferences.get()
    if (!preferences.inlineCompletions) return { items: [] }
    const preference = readDirectModelPreference(preferences.modelSettings)
    if (!preference) return { items: [] }
    const offset = model.getOffsetAt(position)
    const source = model.getValue()
    const prefix = source.slice(Math.max(0, offset - 14_000), offset)
    const suffix = source.slice(offset, offset + 5_000)
    const requestId = crypto.randomUUID()
    const cancellation = cancellationToken.onCancellationRequested(() =>
      bridge.providers.cancel(requestId)
    )
    try {
      const result = await bridge.providers.run(
        requestId,
        preference.model.directProvider,
        {
          model: preference.model.modelId,
          systemPrompt:
            'Complete code at the cursor. Return only the exact text to insert—no Markdown fence, explanation, or repeated prefix.',
          messages: [
            {
              role: 'user',
              content: `Language: ${model.getLanguageId()}\n\n<before_cursor>\n${prefix}\n</before_cursor>\n<after_cursor>\n${suffix}\n</after_cursor>`,
            },
          ],
          effort: 'low',
          reasoningMode: 'standard',
          maxOutputTokens: 1200,
          webSearch: false,
        }
      )
      const insertText = cleanCompletion(result.content)
      if (!insertText || cancellationToken.isCancellationRequested) {
        return { items: [] }
      }
      return {
        items: [
          {
            insertText,
            range: new monaco.Range(
              position.lineNumber,
              position.column,
              position.lineNumber,
              position.column
            ),
          },
        ],
      }
    } catch {
      return { items: [] }
    } finally {
      cancellation.dispose()
    }
  },
  disposeInlineCompletions: () => {},
}

function ensureCompletionProvider(languageId: string) {
  if (completionProviderRegistrations.has(languageId)) return
  completionProviderRegistrations.set(
    languageId,
    monaco.languages.registerInlineCompletionsProvider(
      languageId,
      inlineCompletionsProvider
    )
  )
}

function disposeCompletionProviders() {
  for (const registration of completionProviderRegistrations.values()) {
    registration.dispose()
  }
  completionProviderRegistrations.clear()
}

export function MonacoWorkspaceEditor({
  path,
  language,
  value,
  onChange,
  onSave,
  onCursorChange,
  onInlineEdit,
  pendingLine,
  onPendingLineApplied,
}: {
  path: string
  language: string
  value: string
  onChange: (value: string) => void
  onSave?: () => void
  onCursorChange?: (line: number, column: number) => void
  onInlineEdit?: (selection: WorkspaceInlineSelection) => void
  pendingLine?: number | null
  onPendingLineApplied?: () => void
}) {
  const onSaveRef = useRef(onSave)
  const onCursorChangeRef = useRef(onCursorChange)
  const onInlineEditRef = useRef(onInlineEdit)
  const onPendingLineAppliedRef = useRef(onPendingLineApplied)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const pendingLineRef = useRef<number | null>(null)

  useEffect(() => {
    onSaveRef.current = onSave
  }, [onSave])

  useEffect(() => {
    onCursorChangeRef.current = onCursorChange
  }, [onCursorChange])

  useEffect(() => {
    onInlineEditRef.current = onInlineEdit
  }, [onInlineEdit])

  useEffect(() => {
    onPendingLineAppliedRef.current = onPendingLineApplied
  }, [onPendingLineApplied])

  useEffect(() => {
    pendingLineRef.current =
      pendingLine != null && pendingLine >= 1 ? pendingLine : null
    if (pendingLineRef.current == null) return
    const timer = window.setTimeout(() => {
      const editor = editorRef.current
      const target = pendingLineRef.current
      if (!editor || target == null) return
      editor.setPosition({ lineNumber: target, column: 1 })
      editor.revealLineInCenter(target)
      pendingLineRef.current = null
      onPendingLineAppliedRef.current?.()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [pendingLine, path])

  return (
    <div className="workspace-monaco">
      <Editor
        path={path}
        language={monacoLanguage(language)}
        value={value}
        keepCurrentModel
        saveViewState
        onChange={(next) => onChange(next ?? '')}
        onMount={(editor, monacoInstance) => {
          editorRef.current = editor
          mountedWorkspaceEditorCount += 1
          let trackedModel: monaco.editor.ITextModel | null = null
          const trackCompletionModel = () => {
            if (trackedModel) releaseCompletionModel(trackedModel)
            trackedModel = editor.getModel()
            if (trackedModel) {
              retainCompletionModel(trackedModel)
              ensureCompletionProvider(trackedModel.getLanguageId())
            }
          }
          trackCompletionModel()
          const modelDisposable = editor.onDidChangeModel(trackCompletionModel)
          const saveDisposable = editor.addAction({
            id: 'statskey.workspace.save',
            label: 'Save',
            keybindings: [
              monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS,
            ],
            run: () => onSaveRef.current?.(),
          })
          const inlineEditDisposable = editor.addAction({
            id: 'statskey.workspace.inline-edit',
            label: 'Edit selection with StatsKey',
            keybindings: [
              monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyK,
            ],
            run: () => {
              const model = editor.getModel()
              const position = editor.getPosition()
              if (!model || !position || !onInlineEditRef.current) return
              let selection = editor.getSelection()
              if (!selection || selection.isEmpty()) {
                selection = new monacoInstance.Selection(
                  position.lineNumber,
                  1,
                  position.lineNumber,
                  model.getLineMaxColumn(position.lineNumber)
                )
              }
              onInlineEditRef.current({
                startOffset: model.getOffsetAt(selection.getStartPosition()),
                endOffset: model.getOffsetAt(selection.getEndPosition()),
                selectedText: model.getValueInRange(selection),
                startLine: selection.startLineNumber,
                endLine: selection.endLineNumber,
              })
            },
          })
          const cursorDisposable = editor.onDidChangeCursorPosition((event) => {
            onCursorChangeRef.current?.(
              event.position.lineNumber,
              event.position.column
            )
          })
          const mountLine = pendingLineRef.current
          if (mountLine != null && mountLine >= 1) {
            editor.setPosition({ lineNumber: mountLine, column: 1 })
            editor.revealLineInCenter(mountLine)
            pendingLineRef.current = null
            onPendingLineAppliedRef.current?.()
          }
          editor.focus()
          editor.onDidDispose(() => {
            editorRef.current = null
            if (trackedModel) {
              releaseCompletionModel(trackedModel)
              trackedModel = null
            }
            modelDisposable.dispose()
            saveDisposable.dispose()
            inlineEditDisposable.dispose()
            cursorDisposable.dispose()
            mountedWorkspaceEditorCount -= 1
            if (mountedWorkspaceEditorCount === 0) disposeCompletionProviders()
          })
        }}
        theme="vs"
        options={{
          automaticLayout: true,
          minimap: { enabled: false },
          fontFamily:
            '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 13,
          lineHeight: 20,
          padding: { top: 10, bottom: 18 },
          renderWhitespace: 'selection',
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          wordWrap: 'off',
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          stickyScroll: { enabled: true },
          suggest: { preview: true, showWords: true },
          quickSuggestions: true,
          formatOnPaste: true,
          tabSize: 2,
        }}
      />
    </div>
  )
}

function monacoLanguage(language: string): string {
  if (language === 'shell') return 'shell'
  if (language === 'text') return 'plaintext'
  if (language === 'markdown') return 'markdown'
  return language
}

function readDirectModelPreference(stored: Record<string, unknown> | null) {
  try {
    const raw = (stored ?? {}) as {
      modelLabel?: unknown
      modelId?: unknown
      directProvider?: unknown
      executionRoute?: unknown
    }
    if (raw.executionRoute !== 'direct' || typeof raw.modelLabel !== 'string') {
      return null
    }
    const model = CHAT_MODELS.find(
      (candidate) => candidate.label === raw.modelLabel
    )
    if (model) return { model }
    if (
      typeof raw.modelId === 'string' &&
      isDesktopProviderId(raw.directProvider)
    ) {
      return {
        model: {
          modelId: raw.modelId,
          directProvider: raw.directProvider,
        },
      }
    }
    return null
  } catch {
    return null
  }
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

function cleanCompletion(value: string): string {
  return value
    .trimEnd()
    .replace(/^```[a-z0-9_-]*\n/i, '')
    .replace(/\n```$/, '')
}
