const test = require('node:test')
const assert = require('node:assert/strict')
const {
  providerMetadataForConfig,
  providerStatusFromEntry,
} = require('./provider-vault-runtime.cjs')

const fields = {
  anthropic: ['apiKey'],
  'azure-openai': ['apiKey', 'endpoint', 'deployment', 'apiVersion'],
}
const secretFields = new Set(['apiKey'])
const requiredFields = {
  anthropic: ['apiKey'],
  'azure-openai': ['apiKey', 'endpoint', 'deployment'],
}

test('legacy ciphertext-only entries report configured without decryption', () => {
  const status = providerStatusFromEntry({
    provider: 'anthropic',
    entry: {
      ciphertext: 'legacy-ciphertext',
      updatedAt: '2026-08-10T20:00:00.000Z',
    },
    fields,
    secretFields,
    requiredFields,
  })

  assert.deepEqual(status, {
    provider: 'anthropic',
    configured: true,
    encryptionAvailable: true,
    updatedAt: '2026-08-10T20:00:00.000Z',
    credentials: { apiKey: true },
    config: {},
  })
})

test('saved metadata preserves only public config and secret presence', () => {
  const metadata = providerMetadataForConfig({
    provider: 'azure-openai',
    config: {
      apiKey: 'must-not-leak',
      endpoint: 'https://example.openai.azure.com',
      deployment: 'gpt-production',
      apiVersion: '2026-06-01',
    },
    fields,
    secretFields,
  })
  const status = providerStatusFromEntry({
    provider: 'azure-openai',
    entry: {
      ciphertext: 'ciphertext',
      updatedAt: '2026-08-10T20:01:00.000Z',
      metadata,
    },
    fields,
    secretFields,
    requiredFields,
  })

  assert.equal(JSON.stringify(metadata).includes('must-not-leak'), false)
  assert.deepEqual(status.credentials, { apiKey: true })
  assert.deepEqual(status.config, {
    endpoint: 'https://example.openai.azure.com',
    deployment: 'gpt-production',
    apiVersion: '2026-06-01',
  })
  assert.equal(status.configured, true)
})

test('metadata without ciphertext cannot claim a configured provider', () => {
  const status = providerStatusFromEntry({
    provider: 'anthropic',
    entry: {
      metadata: {
        configured: true,
        encryptionAvailable: true,
        credentials: { apiKey: true },
        config: {},
      },
    },
    fields,
    secretFields,
    requiredFields,
  })
  assert.equal(status.configured, false)
})
