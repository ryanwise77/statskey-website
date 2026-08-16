import { describe, expect, it } from 'vitest'
import {
  UNIVERSAL_INTEGRATION_CATALOG,
  filterIntegrationCatalog,
} from './integrationCatalog'

describe('universal integration catalog', () => {
  it('covers common work, data, development, sales, and automation services', () => {
    expect(UNIVERSAL_INTEGRATION_CATALOG.length).toBeGreaterThanOrEqual(30)
    expect(
      new Set(UNIVERSAL_INTEGRATION_CATALOG.map((item) => item.group))
    ).toEqual(
      new Set([
        'Work',
        'Communication',
        'Data',
        'Development',
        'Sales',
        'Automation',
      ])
    )
  })

  it('searches names, groups, and capability keywords', () => {
    expect(filterIntegrationCatalog('warehouse').map((item) => item.name)).toEqual(
      expect.arrayContaining(['Snowflake', 'BigQuery'])
    )
    expect(filterIntegrationCatalog('microsoft files').map((item) => item.name)).toEqual([
      'OneDrive',
    ])
  })
})
