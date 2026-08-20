'use strict'

const { existsSync, mkdirSync, statSync } = require('node:fs')
const path = require('node:path')

const DEFAULT_PROJECTS_ROOT_NAME = 'StatsKey Projects'
const MAX_PROJECT_FOLDER_NAME_LENGTH = 80
const WINDOWS_RESERVED_NAMES =
  /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * A project folder name is a single path segment: no separators, no leading
 * dots (hidden folders), no control characters, and nothing Windows rejects.
 */
function validateProjectFolderName(value) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (name.length < 1 || name.length > MAX_PROJECT_FOLDER_NAME_LENGTH) {
    return {
      ok: false,
      error: 'Give the project a name between 1 and 80 characters.',
    }
  }
  if (name.startsWith('.')) {
    return { ok: false, error: 'The project name cannot start with a dot.' }
  }
  if (name.endsWith('.') || name.endsWith(' ')) {
    return {
      ok: false,
      error: 'The project name cannot end with a dot or a space.',
    }
  }
  if (name.includes('/') || name.includes('\\')) {
    return {
      ok: false,
      error: 'The project name cannot contain path separators.',
    }
  }
  if (CONTROL_CHARACTERS.test(name)) {
    return {
      ok: false,
      error: 'The project name cannot contain control characters.',
    }
  }
  if (WINDOWS_RESERVED_NAMES.test(name)) {
    return { ok: false, error: 'That project name is reserved by Windows.' }
  }
  return { ok: true, name }
}

/**
 * Creates <home>/StatsKey Projects/<name>, creating the default root on first
 * use, and fails cleanly when the folder already exists. The filesystem is
 * injectable so the behavior is testable without Electron.
 */
function createProjectInDefaultRoot({
  homeDirectory,
  name,
  fsImpl = { existsSync, mkdirSync, statSync },
  pathImpl = path,
} = {}) {
  const validation = validateProjectFolderName(name)
  if (!validation.ok) return validation
  const home = typeof homeDirectory === 'string' ? homeDirectory.trim() : ''
  if (!home) {
    return { ok: false, error: 'The home folder is unavailable.' }
  }
  const root = pathImpl.join(home, DEFAULT_PROJECTS_ROOT_NAME)
  const target = pathImpl.join(root, validation.name)
  try {
    if (fsImpl.existsSync(target)) {
      return { ok: false, error: 'A project with that name already exists.' }
    }
    fsImpl.mkdirSync(target, { recursive: true, mode: 0o700 })
    if (!fsImpl.statSync(target).isDirectory()) {
      return { ok: false, error: 'The project folder could not be created.' }
    }
    return { ok: true, path: target, name: validation.name, root }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : 'The folder could not be created.',
    }
  }
}

module.exports = {
  DEFAULT_PROJECTS_ROOT_NAME,
  MAX_PROJECT_FOLDER_NAME_LENGTH,
  createProjectInDefaultRoot,
  validateProjectFolderName,
}
