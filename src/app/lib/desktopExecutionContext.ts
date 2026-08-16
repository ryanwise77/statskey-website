import type { StatsKeyDesktopBridge } from './desktop'

type DesktopTerminalShell = StatsKeyDesktopBridge['terminalShell']

export function desktopAgentExecutionContext(
  rawPlatform: unknown,
  rawShell: DesktopTerminalShell | undefined
): string {
  const platform = typeof rawPlatform === 'string' ? rawPlatform : ''
  const shell = safeShellName(rawShell?.executable)

  if (platform === 'win32') {
    return [
      'Desktop execution environment:',
      '- Operating system: Windows (win32).',
      `- run_terminal executes with Command Prompt (${shell || 'cmd.exe'}), not a POSIX shell.`,
      '- Author commands with Windows cmd.exe syntax and Windows paths. Do not use bash/zsh-only commands, single-quote semantics, /bin paths, chmod, or POSIX environment-prefix assignments.',
      '- When PowerShell is materially clearer, invoke powershell.exe explicitly with -NoProfile and author the command for PowerShell; do not assume PowerShell for an unqualified command.',
    ].join('\n')
  }

  if (platform === 'darwin') {
    return [
      'Desktop execution environment:',
      '- Operating system: macOS (darwin).',
      `- run_terminal executes with the POSIX login shell (${shell || 'zsh'}).`,
      '- Author commands and paths for macOS; Windows cmd.exe and PowerShell syntax will not work unless explicitly installed and invoked.',
    ].join('\n')
  }

  if (platform === 'linux') {
    return [
      'Desktop execution environment:',
      '- Operating system: Linux.',
      `- run_terminal executes with the POSIX login shell (${shell || 'sh'}).`,
      '- Author commands and paths for the available Linux shell.',
    ].join('\n')
  }

  return ''
}

function safeShellName(candidate: unknown): string {
  if (typeof candidate !== 'string') return ''
  const shell = candidate.trim()
  return /^[A-Za-z0-9._+-]{1,80}$/.test(shell) ? shell : ''
}
