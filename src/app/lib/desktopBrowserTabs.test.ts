import { describe, expect, it } from 'vitest'
import { browserDestination, browserDisplayHost } from './desktopBrowserTabs'

describe('desktop browser tabs', () => {
  it('normalizes domains and local development addresses', () => {
    expect(browserDestination('statskey.ai/docs')).toBe(
      'https://statskey.ai/docs'
    )
    expect(browserDestination('localhost:4173/test')).toBe(
      'http://localhost:4173/test'
    )
  })

  it('uses a search for ordinary questions', () => {
    expect(browserDestination('black scholes calculator')).toBe(
      'https://www.google.com/search?q=black%20scholes%20calculator'
    )
  })

  it('keeps explicit schemes for the native validator to review', () => {
    expect(browserDestination('https://fred.stlouisfed.org/')).toBe(
      'https://fred.stlouisfed.org/'
    )
    expect(browserDestination('')).toBeNull()
  })

  it('builds compact tab labels from URLs', () => {
    expect(browserDisplayHost('https://www.sec.gov/edgar/search/')).toBe(
      'www.sec.gov'
    )
  })
})
