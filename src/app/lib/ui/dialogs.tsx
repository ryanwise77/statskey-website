import { useEffect, useRef, useSyncExternalStore } from 'react'
import '../../ui-foundation.css'

export interface DialogAction {
  id: string
  label: string
  kind?: 'primary' | 'destructive' | 'cancel'
}

interface DialogInput {
  label?: string
  placeholder?: string
  initialValue?: string
  maxLength?: number
}

interface DialogRequest {
  id: number
  title: string
  body?: string
  actions: DialogAction[]
  defaultActionId: string
  input?: DialogInput
  resolve: (value: { actionId: string | null; inputValue: string }) => void
}

export interface ToastEntry {
  id: number
  message: string
  kind: 'success' | 'error' | 'info'
  timeoutMs: number
  actionLabel?: string
  onAction?: () => void
}

interface UiStore {
  dialogs: DialogRequest[]
  toasts: ToastEntry[]
}

let store: UiStore = { dialogs: [], toasts: [] }
let nextId = 1
const listeners = new Set<() => void>()

function update(next: UiStore) {
  store = next
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): UiStore {
  return store
}

function enqueueDialog(
  request: Omit<DialogRequest, 'id' | 'resolve'>
): Promise<{ actionId: string | null; inputValue: string }> {
  return new Promise((resolve) => {
    update({
      ...store,
      dialogs: [...store.dialogs, { ...request, id: nextId++, resolve }],
    })
  })
}

function settleDialog(id: number, actionId: string | null, inputValue: string) {
  const dialog = store.dialogs.find((candidate) => candidate.id === id)
  if (!dialog) return
  update({
    ...store,
    dialogs: store.dialogs.filter((candidate) => candidate.id !== id),
  })
  dialog.resolve({ actionId, inputValue })
}

/**
 * Brand-styled replacement for window.confirm. Resolves true when the user
 * chooses the confirming action. Esc or the cancel button resolve false.
 */
export function confirmDialog(options: {
  title: string
  body?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}): Promise<boolean> {
  const confirmKind = options.destructive ? 'destructive' : 'primary'
  return enqueueDialog({
    title: options.title,
    body: options.body,
    actions: [
      { id: 'cancel', label: options.cancelLabel ?? 'Cancel', kind: 'cancel' },
      { id: 'confirm', label: options.confirmLabel ?? 'OK', kind: confirmKind },
    ],
    defaultActionId: options.destructive ? 'cancel' : 'confirm',
  }).then((result) => result.actionId === 'confirm')
}

/**
 * Multi-action dialog (e.g. Save / Don't Save / Cancel). Resolves the chosen
 * action id, or null when dismissed with Esc.
 */
export function choiceDialog(options: {
  title: string
  body?: string
  actions: DialogAction[]
  defaultActionId?: string
}): Promise<string | null> {
  const fallback =
    options.actions.find((action) => action.kind === 'primary') ??
    options.actions[0]
  return enqueueDialog({
    title: options.title,
    body: options.body,
    actions: options.actions,
    defaultActionId: options.defaultActionId ?? fallback?.id ?? 'cancel',
  }).then((result) => result.actionId)
}

/**
 * Brand-styled replacement for window.prompt (which Electron does not
 * implement). Resolves the trimmed input, or null when cancelled.
 */
export function promptDialog(options: {
  title: string
  body?: string
  label?: string
  placeholder?: string
  initialValue?: string
  confirmLabel?: string
  maxLength?: number
}): Promise<string | null> {
  return enqueueDialog({
    title: options.title,
    body: options.body,
    actions: [
      { id: 'cancel', label: 'Cancel', kind: 'cancel' },
      { id: 'confirm', label: options.confirmLabel ?? 'Save', kind: 'primary' },
    ],
    defaultActionId: 'confirm',
    input: {
      label: options.label,
      placeholder: options.placeholder,
      initialValue: options.initialValue ?? '',
      maxLength: options.maxLength ?? 200,
    },
  }).then((result) =>
    result.actionId === 'confirm' ? result.inputValue.trim() : null
  )
}

/**
 * Lightweight notice. Success/info auto-dismiss; errors stay until dismissed
 * unless a timeout is given.
 */
export function showToast(
  message: string,
  options: {
    kind?: 'success' | 'error' | 'info'
    timeoutMs?: number
    actionLabel?: string
    onAction?: () => void
  } = {}
) {
  const kind = options.kind ?? 'info'
  const entry: ToastEntry = {
    id: nextId++,
    message,
    kind,
    timeoutMs: options.timeoutMs ?? (kind === 'error' ? 0 : 4000),
    actionLabel: options.actionLabel,
    onAction: options.onAction,
  }
  update({ ...store, toasts: [...store.toasts, entry] })
  return entry.id
}

export function dismissToast(id: number) {
  if (!store.toasts.some((toast) => toast.id === id)) return
  update({ ...store, toasts: store.toasts.filter((toast) => toast.id !== id) })
}

export const _uiStoreForTests = {
  read: () => store,
  reset: () => update({ dialogs: [], toasts: [] }),
  settleDialog,
}

export function DialogHost() {
  const { dialogs } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const dialog = dialogs[0]
  if (!dialog) return null
  return <DialogCard key={dialog.id} dialog={dialog} />
}

function DialogCard({ dialog }: { dialog: DialogRequest }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const defaultRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (dialog.input) inputRef.current?.select()
    else defaultRef.current?.focus()
  }, [dialog.id])

  function settle(actionId: string | null) {
    settleDialog(dialog.id, actionId, inputRef.current?.value ?? '')
  }

  // Key handling lives on window in the capture phase so the modal owns the
  // keyboard even if focus escapes it, and so Escape/Enter/Tab never leak to
  // window-level app shortcuts behind the backdrop (e.g. the desktop approval
  // gate's Escape-to-deny, Workspace tab cycling).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const section = sectionRef.current
      const target = event.target instanceof Node ? event.target : null
      const insideDialog =
        section != null && target != null && section.contains(target)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        settle(null)
        return
      }
      if (event.key === 'Enter') {
        event.stopPropagation()
        // A focused dialog button keeps its native Enter-to-click behavior.
        if (
          insideDialog &&
          target instanceof HTMLElement &&
          target.tagName === 'BUTTON'
        ) {
          return
        }
        event.preventDefault()
        if (dialog.input && !inputRef.current?.value.trim()) return
        settle(dialog.defaultActionId)
        return
      }
      if (event.key === 'Tab') {
        event.stopPropagation()
        const focusables = section?.querySelectorAll<HTMLElement>(
          'button, input'
        )
        if (!section || !focusables || focusables.length === 0) return
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (!active || !section.contains(active)) {
          // Focus escaped the dialog (e.g. after a backdrop click); pull it
          // back in instead of letting Tab walk the page behind the modal.
          event.preventDefault()
          first.focus()
          return
        }
        if (event.shiftKey && active === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && active === last) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      // Any other key whose target is outside the dialog (body, background
      // page, …) must not reach app-level shortcut handlers. Keys inside the
      // dialog propagate normally so typing in the input keeps working.
      if (!insideDialog) event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
    // settle/dialog are stable for a given dialog id; DialogCard is keyed
    // by it, so a new dialog remounts this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog.id])

  return (
    <div
      className="sk-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        // Clicking the dimmed backdrop must not move focus to <body>, which
        // would drop keyboard modality; clicks inside the dialog keep their
        // native focus behavior (click-to-focus, drag-select in the input).
        if (event.target === event.currentTarget) event.preventDefault()
      }}
    >
      <section
        ref={sectionRef}
        className="sk-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`sk-dialog-title-${dialog.id}`}
      >
        <h2 id={`sk-dialog-title-${dialog.id}`}>{dialog.title}</h2>
        {dialog.body && <p>{dialog.body}</p>}
        {dialog.input && (
          <label className="sk-dialog__input">
            {dialog.input.label && <span>{dialog.input.label}</span>}
            <input
              ref={inputRef}
              defaultValue={dialog.input.initialValue}
              placeholder={dialog.input.placeholder}
              maxLength={dialog.input.maxLength}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        )}
        <div className="sk-dialog__actions">
          {dialog.actions.map((action) => (
            <button
              key={action.id}
              ref={action.id === dialog.defaultActionId ? defaultRef : undefined}
              type="button"
              className={`sk-dialog__action sk-dialog__action--${action.kind ?? 'cancel'}`}
              onClick={() => settle(action.id === 'cancel' ? null : action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

export function ToastHost() {
  const { toasts } = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (toasts.length === 0) return null
  return (
    <div className="sk-toasts" role="region" aria-label="Notifications">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  )
}

function ToastCard({ toast }: { toast: ToastEntry }) {
  useEffect(() => {
    if (toast.timeoutMs <= 0) return
    const timer = window.setTimeout(() => dismissToast(toast.id), toast.timeoutMs)
    return () => window.clearTimeout(timer)
  }, [toast.id, toast.timeoutMs])

  return (
    <div
      className={`sk-toast sk-toast--${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
    >
      <span>{toast.message}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          onClick={() => {
            toast.onAction?.()
            dismissToast(toast.id)
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button
        type="button"
        className="sk-toast__close"
        aria-label="Dismiss notification"
        onClick={() => dismissToast(toast.id)}
      >
        ×
      </button>
    </div>
  )
}
