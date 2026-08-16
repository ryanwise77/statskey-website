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
