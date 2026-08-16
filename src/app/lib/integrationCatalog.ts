export type IntegrationCatalogGroup =
  | 'Work'
  | 'Communication'
  | 'Data'
  | 'Development'
  | 'Sales'
  | 'Automation'

export interface IntegrationCatalogItem {
  id: string
  name: string
  group: IntegrationCatalogGroup
  keywords: string
}

export const UNIVERSAL_INTEGRATION_CATALOG: readonly IntegrationCatalogItem[] = [
  { id: 'linear', name: 'Linear', group: 'Work', keywords: 'issues projects' },
  { id: 'notion', name: 'Notion', group: 'Work', keywords: 'docs wiki knowledge' },
  { id: 'jira', name: 'Jira', group: 'Work', keywords: 'issues projects atlassian' },
  { id: 'asana', name: 'Asana', group: 'Work', keywords: 'tasks projects' },
  { id: 'monday', name: 'Monday.com', group: 'Work', keywords: 'tasks projects' },
  { id: 'trello', name: 'Trello', group: 'Work', keywords: 'boards tasks' },
  { id: 'slack', name: 'Slack', group: 'Communication', keywords: 'messages channels' },
  { id: 'teams', name: 'Microsoft Teams', group: 'Communication', keywords: 'messages meetings' },
  { id: 'discord', name: 'Discord', group: 'Communication', keywords: 'messages servers' },
  { id: 'gmail', name: 'Gmail', group: 'Communication', keywords: 'google email mail' },
  { id: 'outlook', name: 'Outlook', group: 'Communication', keywords: 'microsoft email mail' },
  { id: 'drive', name: 'Google Drive', group: 'Data', keywords: 'files docs sheets' },
  { id: 'onedrive', name: 'OneDrive', group: 'Data', keywords: 'microsoft files sharepoint' },
  { id: 'dropbox', name: 'Dropbox', group: 'Data', keywords: 'files storage' },
  { id: 'box', name: 'Box', group: 'Data', keywords: 'files storage' },
  { id: 'airtable', name: 'Airtable', group: 'Data', keywords: 'database records' },
  { id: 'postgres', name: 'PostgreSQL', group: 'Data', keywords: 'database sql' },
  { id: 'snowflake', name: 'Snowflake', group: 'Data', keywords: 'warehouse sql' },
  { id: 'databricks', name: 'Databricks', group: 'Data', keywords: 'lakehouse analytics' },
  { id: 'bigquery', name: 'BigQuery', group: 'Data', keywords: 'google warehouse sql' },
  { id: 'github', name: 'GitHub tools', group: 'Development', keywords: 'code repositories pull requests' },
  { id: 'gitlab', name: 'GitLab', group: 'Development', keywords: 'code repositories merge requests' },
  { id: 'sentry', name: 'Sentry', group: 'Development', keywords: 'errors monitoring' },
  { id: 'datadog', name: 'Datadog', group: 'Development', keywords: 'monitoring observability' },
  { id: 'vercel', name: 'Vercel', group: 'Development', keywords: 'deploy hosting' },
  { id: 'cloudflare', name: 'Cloudflare', group: 'Development', keywords: 'deploy dns workers' },
  { id: 'figma', name: 'Figma', group: 'Development', keywords: 'design files' },
  { id: 'salesforce', name: 'Salesforce', group: 'Sales', keywords: 'crm customers' },
  { id: 'hubspot', name: 'HubSpot', group: 'Sales', keywords: 'crm marketing' },
  { id: 'stripe', name: 'Stripe tools', group: 'Sales', keywords: 'billing payments customers' },
  { id: 'zapier', name: 'Zapier', group: 'Automation', keywords: 'workflows actions' },
  { id: 'make', name: 'Make', group: 'Automation', keywords: 'workflows actions integromat' },
  { id: 'n8n', name: 'n8n', group: 'Automation', keywords: 'workflows actions self hosted' },
] as const

export function filterIntegrationCatalog(
  query: string
): readonly IntegrationCatalogItem[] {
  const terms = query
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (terms.length === 0) return UNIVERSAL_INTEGRATION_CATALOG
  return UNIVERSAL_INTEGRATION_CATALOG.filter((item) => {
    const haystack = `${item.name} ${item.group} ${item.keywords}`.toLocaleLowerCase()
    return terms.every((term) => haystack.includes(term))
  })
}
