import { afterEach, expect, test } from 'vitest'
import {
  _uiStoreForTests,
  choiceDialog,
  confirmDialog,
  dismissToast,
  promptDialog,
  showToast,
} from './dialogs'

afterEach(() => {
  _uiStoreForTests.reset()
})

test('confirmDialog resolves true on confirm and false on dismiss', async () => {
  const first = confirmDialog({ title: 'Close file?', destructive: true })
  const second = confirmDialog({ title: 'Another?' })
  const queue = _uiStoreForTests.read().dialogs
  expect(queue).toHaveLength(2)
  expect(queue[0].defaultActionId).toBe('cancel')
  expect(queue[1].defaultActionId).toBe('confirm')

  _uiStoreForTests.settleDialog(queue[0].id, 'confirm', '')
  _uiStoreForTests.settleDialog(queue[1].id, null, '')
  await expect(first).resolves.toBe(true)
  await expect(second).resolves.toBe(false)
  expect(_uiStoreForTests.read().dialogs).toHaveLength(0)
})

test('promptDialog trims input and returns null on cancel', async () => {
  const saved = promptDialog({ title: 'Name workspace', initialValue: 'Alpha' })
  const savedId = _uiStoreForTests.read().dialogs[0].id
  _uiStoreForTests.settleDialog(savedId, 'confirm', '  New name  ')
  await expect(saved).resolves.toBe('New name')

  const cancelled = promptDialog({ title: 'Name workspace' })
  const cancelledId = _uiStoreForTests.read().dialogs[0].id
  _uiStoreForTests.settleDialog(cancelledId, null, 'typed anyway')
  await expect(cancelled).resolves.toBeNull()
})

test('choiceDialog returns the chosen action id', async () => {
  const choice = choiceDialog({
    title: 'Save changes?',
    actions: [
      { id: 'save', label: 'Save', kind: 'primary' },
      { id: 'discard', label: "Don't Save", kind: 'destructive' },
      { id: 'cancel', label: 'Cancel', kind: 'cancel' },
    ],
  })
  const dialog = _uiStoreForTests.read().dialogs[0]
  expect(dialog.defaultActionId).toBe('save')
  _uiStoreForTests.settleDialog(dialog.id, 'discard', '')
  await expect(choice).resolves.toBe('discard')
})

test('toasts default to sticky errors and dismiss by id', () => {
  const errorId = showToast('Commit failed', { kind: 'error' })
  const infoId = showToast('Saved')
  const toasts = _uiStoreForTests.read().toasts
  expect(toasts.find((toast) => toast.id === errorId)?.timeoutMs).toBe(0)
  expect(toasts.find((toast) => toast.id === infoId)?.timeoutMs).toBe(4000)
  dismissToast(errorId)
  expect(_uiStoreForTests.read().toasts.map((toast) => toast.id)).toEqual([infoId])
})
