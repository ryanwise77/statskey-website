const { chmodSync, existsSync, readdirSync, statSync } = require('node:fs')
const path = require('node:path')

const prebuilds = path.join(__dirname, 'node_modules', 'node-pty', 'prebuilds')
if (!existsSync(prebuilds)) process.exit(0)

for (const platformDirectory of readdirSync(prebuilds)) {
  const helper = path.join(prebuilds, platformDirectory, 'spawn-helper')
  if (!existsSync(helper) || !statSync(helper).isFile()) continue
  chmodSync(helper, 0o755)
}
