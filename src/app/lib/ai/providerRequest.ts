/**
 * Adds callable tools only when a round can actually execute one.
 *
 * Some provider adapters treat an explicit empty tool catalog differently
 * from an omitted catalog (for example by enabling client tool discovery with
 * nothing available to discover). Keeping this at the request boundary makes
 * final handoffs unambiguously tool-free while preserving normal tool rounds.
 */
export function withProviderTools<T extends object>(request: T): T
export function withProviderTools<T extends object, Tool>(
  request: T,
  tools: readonly Tool[]
): T & { tools?: Tool[] }
export function withProviderTools<T extends object, Tool>(
  request: T,
  tools?: readonly Tool[]
): T | (T & { tools?: Tool[] }) {
  if (!tools || tools.length === 0) {
    return request
  }
  return { ...request, tools: [...tools] }
}
