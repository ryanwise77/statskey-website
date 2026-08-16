export interface WorkspaceWelcomeSuggestion {
  title: string
  description: string
  prompt: string
  mode: 'ask'
}

export const WORKSPACE_WELCOME_COPY = {
  heading: 'What moves this forward?',
  description:
    'Say what you know. StatsKey can orient, investigate, plan, and carry the work through when you are ready.',
  control:
    'Nothing to configure up front. The right depth appears as the work needs it.',
} as const

export const WORKSPACE_WELCOME_SUGGESTIONS: WorkspaceWelcomeSuggestion[] = [
  {
    title: 'Make something',
    description: 'Turn a rough thought into a clear outcome and working result.',
    prompt:
      'I have a rough idea. Help me shape what we should build and why. Ask me a few focused questions about the outcome, who it is for, and what success looks like before recommending a direction. Do not make changes yet.',
    mode: 'ask',
  },
  {
    title: 'Fix what is stuck',
    description: 'Trace the real cause, then choose the cleanest solution.',
    prompt:
      'Help me figure out what we should build to solve a problem. Start by asking about the problem, who it affects, the constraints, and the desired outcome. Then give me a few strong directions with clear tradeoffs. Do not make changes yet.',
    mode: 'ask',
  },
  {
    title: 'Understand the work',
    description: 'Explore the workspace and surface what matters first.',
    prompt:
      'Look through this workspace and suggest three valuable things we could build or improve. Ask what matters if the goal or audience is unclear, explain each direction in plain language, and do not make changes yet.',
    mode: 'ask',
  },
]
