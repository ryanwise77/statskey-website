import { describe, expect, it, vi } from 'vitest'

// Pure-helper tests only: the Firestore-backed store is exercised through
// fakes in the engine/transfer suites. Mock the firebase bootstrap so
// importing the module never initializes an app in the test process.
vi.mock('../firebase', () => ({ db: {} }))

import { Timestamp } from 'firebase/firestore'
import {
  base64ToBytes,
  bytesToBase64,
  decodeLiveSyncContainer,
  decodeSyncFileDoc,
  decodeTransferContainer,
  joinChunks,
  randomSyncId,
  sha256Hex,
  splitChunks,
  syncFileDocId,
} from './snapshotStore'
import { SYNC_CHUNK_BYTES } from './types'

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

describe('base64 helpers', () => {
  it('round-trips random binary bytes including 0 and 255', () => {
    const bytes = randomBytes(70_003)
    bytes[0] = 0
    bytes[1] = 255
    bytes[bytes.length - 1] = 0
    bytes[bytes.length - 2] = 255
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })

  it('matches known base64 vectors', () => {
    expect(bytesToBase64(new Uint8Array([0, 255, 16]))).toBe('AP8Q')
    expect(bytesToBase64(new TextEncoder().encode('hello world'))).toBe(
      'aGVsbG8gd29ybGQ='
    )
    expect(base64ToBytes('AP8Q')).toEqual(new Uint8Array([0, 255, 16]))
  })

  it('round-trips the empty byte array', () => {
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
    expect(base64ToBytes('')).toEqual(new Uint8Array(0))
  })

  it('handles every single-byte value', () => {
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) all[i] = i
    expect(base64ToBytes(bytesToBase64(all))).toEqual(all)
  })
})

describe('splitChunks / joinChunks', () => {
  const boundarySizes = [0, 1, SYNC_CHUNK_BYTES, SYNC_CHUNK_BYTES + 1]

  it.each(boundarySizes)('round-trips %i bytes', (size) => {
    const bytes = randomBytes(size)
    const chunks = splitChunks(bytes)
    expect(chunks.length).toBe(Math.ceil(size / SYNC_CHUNK_BYTES))
    expect(joinChunks(chunks)).toEqual(bytes)
  })

  it('splits exactly at the chunk byte cap', () => {
    const bytes = randomBytes(SYNC_CHUNK_BYTES + 1)
    const chunks = splitChunks(bytes)
    expect(chunks).toHaveLength(2)
    expect(base64ToBytes(chunks[0])).toHaveLength(SYNC_CHUNK_BYTES)
    expect(base64ToBytes(chunks[1])).toHaveLength(1)
    // Each encoded chunk doc must stay well under Firestore's 1MiB doc cap.
    expect(chunks[0].length).toBeLessThan(1_000_000)
  })
})

describe('sha256Hex', () => {
  it('matches the known SHA-256 vector for "abc"', async () => {
    const bytes = new TextEncoder().encode('abc')
    await expect(sha256Hex(bytes)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })

  it('matches the known SHA-256 vector for empty input', async () => {
    await expect(sha256Hex(new Uint8Array(0))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    )
  })

  it('hashes subarray views by their visible bytes only', async () => {
    const backing = new TextEncoder().encode('xxabcxx')
    const view = backing.subarray(2, 5)
    await expect(sha256Hex(view)).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    )
  })
})

describe('syncFileDocId', () => {
  it('is a stable 40-char hex prefix of sha256(rootId:path)', async () => {
    const id = await syncFileDocId('aaaa1111', 'src/app.ts')
    expect(id).toMatch(/^[a-f0-9]{40}$/)
    const full = await sha256Hex(new TextEncoder().encode('aaaa1111:src/app.ts'))
    expect(id).toBe(full.slice(0, 40))
    await expect(syncFileDocId('aaaa1111', 'src/app.ts')).resolves.toBe(id)
  })

  it('differs across roots and paths', async () => {
    const a = await syncFileDocId('aaaa1111', 'src/app.ts')
    const b = await syncFileDocId('bbbb2222', 'src/app.ts')
    const c = await syncFileDocId('aaaa1111', 'src/other.ts')
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe('randomSyncId', () => {
  it.each(['ws', 'bk', 'tr', 'dev'] as const)(
    'mints %s ids with 20 hex chars',
    (prefix) => {
      const id = randomSyncId(prefix)
      expect(id).toMatch(new RegExp(`^${prefix}_[a-f0-9]{20}$`))
    }
  )

  it('mints distinct ids', () => {
    expect(randomSyncId('ws')).not.toBe(randomSyncId('ws'))
  })
})

describe('decodeSyncFileDoc', () => {
  const valid = {
    schemaVersion: 1,
    rootId: 'aaaa1111',
    path: 'src/app.ts',
    deleted: false,
    size: 42,
    contentHash: 'abc123',
    executable: true,
    chunkCount: 2,
    rev: 3,
    modifiedAt: Timestamp.fromMillis(1_700_000_000_000),
    device: { id: 'dev_x', label: 'MacBook Pro' },
  }

  it('decodes a well-formed doc', () => {
    const decoded = decodeSyncFileDoc(valid, 'file-1')
    expect(decoded).toEqual({
      id: 'file-1',
      rootId: 'aaaa1111',
      path: 'src/app.ts',
      deleted: false,
      size: 42,
      contentHash: 'abc123',
      executable: true,
      chunkCount: 2,
      chunkVersion: null,
      rev: 3,
      modifiedAt: new Date(1_700_000_000_000),
      updatedAt: null,
      device: { id: 'dev_x', label: 'MacBook Pro' },
    })
  })

  it('skips rows without a usable identity', () => {
    expect(decodeSyncFileDoc({ ...valid, rootId: undefined }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({ ...valid, rootId: 7 }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({ ...valid, path: '' }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({}, 'x')).toBeNull()
  })

  it('skips rows with hostile paths', () => {
    expect(decodeSyncFileDoc({ ...valid, path: '../escape.ts' }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({ ...valid, path: 'a/../../b' }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({ ...valid, path: '/etc/passwd' }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({ ...valid, path: 'a//b' }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({ ...valid, path: 'a\\b' }, 'x')).toBeNull()
    expect(decodeSyncFileDoc({ ...valid, path: './a' }, 'x')).toBeNull()
    expect(
      decodeSyncFileDoc({ ...valid, path: `long/${'a'.repeat(1024)}` }, 'x')
    ).toBeNull()
  })

  it('accepts only the bounded chunk-version identifier', () => {
    expect(
      decodeSyncFileDoc(
        { ...valid, chunkVersion: `up_${'a'.repeat(20)}` },
        'versioned'
      )?.chunkVersion
    ).toBe(`up_${'a'.repeat(20)}`)
    expect(
      decodeSyncFileDoc(
        { ...valid, chunkVersion: '../../other' },
        'hostile-version'
      )?.chunkVersion
    ).toBeNull()
  })

  it('coerces hostile field types to safe defaults', () => {
    const decoded = decodeSyncFileDoc(
      {
        rootId: 'aaaa1111',
        path: 'src/app.ts',
        deleted: 'yes',
        size: 'big',
        contentHash: 7,
        executable: 'true',
        chunkCount: Number.NaN,
        rev: null,
        modifiedAt: 'not a date',
        updatedAt: [],
        device: 'nope',
      },
      'file-2'
    )
    expect(decoded).toEqual({
      id: 'file-2',
      rootId: 'aaaa1111',
      path: 'src/app.ts',
      deleted: false,
      size: 0,
      contentHash: '',
      executable: false,
      chunkCount: 0,
      chunkVersion: null,
      rev: 0,
      modifiedAt: null,
      updatedAt: null,
      device: { id: '', label: '' },
    })
  })
})

describe('decodeLiveSyncContainer', () => {
  it('preserves the permanent deleted tombstone', () => {
    expect(
      decodeLiveSyncContainer({ status: 'deleted' }, 'ws_deleted').status
    ).toBe('deleted')
  })
})

describe('decodeTransferContainer', () => {
  it('defaults hostile fields safely', () => {
    const decoded = decodeTransferContainer(
      {
        name: 7,
        roots: [{ id: 'aaaa1111', name: 'app' }, { name: 'no-id' }, 'junk'],
        status: 'exploded',
        targetDeviceId: '',
        claimedBy: 'garbage',
        fileCount: '9',
        totalBytes: null,
      },
      'tr_1'
    )
    expect(decoded.id).toBe('tr_1')
    expect(decoded.name).toBe('Workspace')
    expect(decoded.roots).toEqual([{ id: 'aaaa1111', name: 'app' }])
    expect(decoded.status).toBe('uploading')
    expect(decoded.targetDeviceId).toBeNull()
    expect(decoded.claimedBy).toBeNull()
    expect(decoded.fileCount).toBe(0)
    expect(decoded.totalBytes).toBe(0)
    expect(decoded.expiresAt).toEqual(new Date(0))
  })

  it('keeps valid transfer fields', () => {
    const decoded = decodeTransferContainer(
      {
        name: 'My Workspace',
        status: 'ready',
        targetDeviceId: 'dev_abc',
        claimedBy: { id: 'dev_abc', label: 'Server' },
        expiresAt: Timestamp.fromMillis(1_800_000_000_000),
      },
      'tr_2'
    )
    expect(decoded.status).toBe('ready')
    expect(decoded.targetDeviceId).toBe('dev_abc')
    expect(decoded.claimedBy).toEqual({ id: 'dev_abc', label: 'Server' })
    expect(decoded.expiresAt).toEqual(new Date(1_800_000_000_000))
  })
})
