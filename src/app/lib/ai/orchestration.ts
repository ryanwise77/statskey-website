export type OrchestrationMode = 'focused' | 'adaptive' | 'parallel'

const COMPLEX_LOOKUP_MARKERS =
  /\b(?:analy[sz]e|architecture|audit|bug|code|codebase|compare|current|debug|error|failure|implementation|investigate|latest|multiple|project|repository|research|review|root cause|sources?|stack trace|trade-?offs?|versus)\b/i

/**
 * Short, atomic fact lookups do not benefit from a second context window.
 * Keep this intentionally narrow: ambiguous or compound requests still leave
 * delegation available to the lead model, which applies the orchestration policy.
 */
export function isSimpleFactLookup(
  agentMode: 'ask' | 'plan' | 'debug' | 'agent',
  userText: string
): boolean {
  if (agentMode !== 'ask') return false
  const text = userText.trim()
  if (!text || text.length > 240) return false
  if (/\r|\n|;/.test(text)) return false
  if ((text.match(/\?/g) || []).length > 1) return false
  if (COMPLEX_LOOKUP_MARKERS.test(text)) return false
  if (/\b(?:and also|as well as)\b/i.test(text)) return false
  return /^(?:define\b|who\b|when\b|where\b|how (?:many|much|old|long)\b|what(?:'s|\s+(?:is|are|was|were))\b|(?:is|are|was|were|does|do|did|can)\b)/i.test(
    text
  )
}

export function adaptiveDelegationAllowed(
  agentMode: 'ask' | 'plan' | 'debug' | 'agent',
  userText: string
): boolean {
  return !isSimpleFactLookup(agentMode, userText)
}
