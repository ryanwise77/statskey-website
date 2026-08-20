export interface SearchableModel {
  label: string
  providerLabel: string
  modelId: string
  description: string
  badges?: readonly string[]
}

export function modelMatchesQuery(
  model: SearchableModel,
  query: string
): boolean {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (terms.length === 0) return true

  const haystack = [
    model.label,
    model.providerLabel,
    model.modelId,
    model.description,
    ...(model.badges ?? []),
  ]
    .join(' ')
    .toLocaleLowerCase()

  return terms.every((term) => haystack.includes(term))
}

export function isLikelyAgenticModelId(
  provider: string,
  modelId: string
): boolean {
  const id = modelId.trim()
  if (!id || id.length > 240 || /[\u0000-\u001f\u007f]/.test(id)) return false
  if (
    /(?:^|[-_.])(?:audio|dall-e|embed|embedding|image|imagen|moderation|realtime|speech|transcri(?:be|ption)|tts|veo|video|whisper)(?:$|[-_.])/i.test(
      id
    )
  ) {
    return false
  }
  if (provider === 'openai') return /^(?:chatgpt-|codex-|gpt-|o\d)/i.test(id)
  if (provider === 'anthropic') return /^claude-/i.test(id)
  if (provider === 'google') return /^gemini-/i.test(id)
  if (provider === 'xai') return /^grok-/i.test(id)
  if (provider === 'moonshot') return /^(?:kimi|moonshot)/i.test(id)
  return false
}
