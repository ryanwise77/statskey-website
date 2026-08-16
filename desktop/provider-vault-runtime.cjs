function providerMetadataForConfig({ provider, config, fields, secretFields }) {
  const credentials = {}
  const publicConfig = {}
  for (const field of fields[provider] || []) {
    if (secretFields.has(field)) {
      credentials[field] = Boolean(config?.[field])
    } else if (typeof config?.[field] === 'string' && config[field]) {
      publicConfig[field] = config[field]
    }
  }
  return {
    configured: true,
    encryptionAvailable: true,
    credentials,
    config: publicConfig,
  }
}

/**
 * Produces startup-safe provider state using plaintext non-secret metadata
 * only. Legacy ciphertext proves that a complete configuration was saved, so
 * it remains selectable without asking Keychain to decrypt during launch.
 */
function providerStatusFromEntry({
  provider,
  entry,
  fields,
  secretFields,
  requiredFields,
}) {
  const hasCiphertext =
    typeof entry?.ciphertext === 'string' && entry.ciphertext.length > 0
  const metadata =
    entry?.metadata != null &&
    typeof entry.metadata === 'object' &&
    !Array.isArray(entry.metadata)
      ? entry.metadata
      : null
  const credentials = {}
  const publicConfig = {}

  for (const field of fields[provider] || []) {
    if (secretFields.has(field)) {
      credentials[field] = metadata
        ? metadata.credentials?.[field] === true
        : hasCiphertext && (requiredFields[provider] || []).includes(field)
      continue
    }
    const value = metadata?.config?.[field]
    if (typeof value === 'string' && value && value.length <= 8_192) {
      publicConfig[field] = value
    }
  }

  return {
    provider,
    configured: hasCiphertext && (metadata?.configured !== false),
    encryptionAvailable:
      metadata?.encryptionAvailable === true || hasCiphertext,
    updatedAt:
      typeof entry?.updatedAt === 'string' ? entry.updatedAt : null,
    credentials,
    config: publicConfig,
  }
}

module.exports = {
  providerMetadataForConfig,
  providerStatusFromEntry,
}
