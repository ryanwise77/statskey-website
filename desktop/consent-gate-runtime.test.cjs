const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const appRoot = path.join(__dirname, '..', 'src', 'app')
const componentSource = fs.readFileSync(
  path.join(
    appRoot,
    'components',
    'assistant',
    'IntelligenceConsentGate.tsx'
  ),
  'utf8'
)
const workspaceRailSource = fs.readFileSync(
  path.join(appRoot, 'components', 'workspace', 'WorkspaceAgentRail.tsx'),
  'utf8'
)
const cssSource = fs.readFileSync(path.join(appRoot, 'app.css'), 'utf8')

test('desktop Intelligence consent keeps its controls reachable', () => {
  assert.match(
    componentSource,
    /className="intel-consent__body"[\s\S]*className="intel-consent__actions"/
  )
  assert.match(
    componentSource,
    /'statsKeyDesktop' in window[\s\S]*\? '\/workspace'[\s\S]*: '\/'/
  )
  assert.match(
    componentSource,
    /onDismiss[\s\S]*onClick=\{onDismiss\}[\s\S]*Not now/
  )
  assert.match(
    workspaceRailSource,
    /<IntelligenceConsentGate onDismiss=\{onClose\}>/
  )
  assert.match(
    cssSource,
    /\.desktop-main--workbench > \.intel-consent,[\s\S]*grid-template-rows: auto minmax\(0, 1fr\) auto;[\s\S]*overflow: hidden;/
  )
  assert.match(
    cssSource,
    /\.desktop-main--workbench > \.intel-consent > \.intel-consent__body,[\s\S]*overflow-y: auto;[\s\S]*overscroll-behavior: contain;/
  )
})
