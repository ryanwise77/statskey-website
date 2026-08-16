import { describe, expect, it } from 'vitest'
import { withProviderTools } from './providerRequest'

describe('withProviderTools', () => {
  it('omits the tools field for a final handoff', () => {
    const request = withProviderTools({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'Write the final summary.' }],
      web_search: false,
    })

    expect(Object.hasOwn(request, 'tools')).toBe(false)
    expect(request.web_search).toBe(false)
  })

  it('also omits an explicitly empty catalog', () => {
    const request = withProviderTools(
      { model: 'gpt-5.6-sol', messages: [] },
      []
    )

    expect(Object.hasOwn(request, 'tools')).toBe(false)
  })

  it('preserves the complete catalog for an ordinary tool round', () => {
    const tools = [
      { name: 'workspace_read' },
      { name: 'workspace_write' },
    ]
    const request = withProviderTools(
      { model: 'gpt-5.6-sol', messages: [] },
      tools
    )

    expect(request.tools).toEqual(tools)
    expect(request.tools).not.toBe(tools)
  })
})
