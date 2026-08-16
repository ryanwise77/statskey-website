# StatsKey Desktop Capability Contract

Verified against `cursor-functionality-catalog.md` dated August 6, 2026.

This document accounts for the entire reference catalog. It is a capability
contract, not a mandate to copy another product's chrome or terminology.
StatsKey keeps one calm, work-first surface and exposes complexity only when it
helps complete a task.

## Status language

- **Shipped** — usable in the current desktop client.
- **Partial** — a reliable foundation exists, but material behavior is missing.
- **Next local** — belongs in the local desktop product and is not blocked by a
  hosted service.
- **Service-dependent** — requires durable hosted execution, third-party app
  registration, or organization infrastructure.
- **Excluded** — intentionally omitted because it adds risk or technical
  clutter without improving the user outcome.

## Product principles

1. Agent and work remain visible together.
2. Every destructive or external action has a legible approval boundary.
3. Local files, credentials, and provider keys stay local unless the user
   explicitly chooses a connected service.
4. One action should have one obvious home; avoid duplicate IDE panels.
5. Advanced controls are progressively disclosed.
6. A capability is not marked shipped until its real end-to-end path is tested.

## 1. Product surfaces

- **Shipped:** macOS, Windows, authenticated browser app, local desktop
  workspace, GitHub-backed browser workspace, distinct personal Plan surface,
  iOS health application.
- **Partial:** web editing is GitHub-backed but does not host long-running
  agents; desktop and mobile conversations are not yet one unified task list.
- **Next local:** command-line companion and deep links into files, chats, and
  approvals.
- **Service-dependent:** hosted agents, Android agent surface, Slack, Teams,
  Jira, Linear, and source-control comment triggers.
- **Excluded:** requiring a paid hosted service for ordinary local editing.

## 2. Agent-first window

- **Shipped:** Agent-first home, local workspace picker, multi-root import,
  files, tabs, changes, terminal, checkpoints, movable/resizable Agent,
  persisted layouts, simultaneous split editors, drag-reorderable and close-all
  file tabs, persistent reorderable/closable desktop surface tabs with reopen
  menu and active-Agent badge, exact conversation recovery when a running Agent
  surface is reopened, independently closable/reorderable Agent session tabs,
  separate Work and Personal Agent tabs, globally accessible workspace quick
  tools, direct workspace Settings access, full editor/Agent focus presets,
  edge-to-edge pane geometry, optional full-window canvas mode, and isolated
  task workspaces, a first-class controlled Browser surface with multiple
  isolated tabs, and directly discoverable Files, Search, and Add files actions.
- **Partial:** two simultaneous provider runs are supported; there is no
  mission-control overview, tiled Agent fleet, pull-request tab, worktree
  switcher, or voice capture.
- **Next local:** mission-control/tiled Agent sessions, worktree tasks,
  richer browser inspection, and pull-request review.
- **Service-dependent:** unified cloud/mobile/chat-origin Agent inbox.

## 3. Editor foundation

- **Shipped:** Monaco editing, syntax support, multi-tab documents, preserved
  undo/view state, durable tab order, two independently focused editor panes,
  file tree, encrypted hybrid local search, create/rename/delete, terminal, Git
  status/diff, command palette, status details, plain-language create/open
  project flows, multi-root expansion, and compatible workspace import.
- **Partial:** no debugger, extension marketplace, theme editor, shortcut
  editor, symbol outline, or full source-control staging UI.
- **Next local:** symbol navigation, diagnostics panel, configurable appearance,
  shortcut discovery, commit/stage controls, and task/debug launchers.
- **Excluded:** exposing a second settings system or an unreviewed extension
  supply chain.

## 4. Predictive editing

- **Shipped:** local inline completion setting and provider-backed Monaco
  completion path.
- **Partial:** no partial-word acceptance, next-edit jumps, cross-file portal,
  per-language controls, snooze, or completion governance hooks.
- **Next local:** completion lifecycle controls, partial acceptance, related
  edit previews, and per-language policy.

## 5. Inline edit

- **Shipped:** selection-aware edit prompt, question mode, terminal command
  generation, reviewable replacement preview, undo-safe draft application, and
  escalation to Agent with file/line context.
- **Partial:** multi-turn inline follow-ups and related cross-file edits remain
  Agent workflows.
- **Required quality bar:** preserves undo, never writes before preview or
  applicable approval, and keeps selection/cursor state.

## 6. Agent modes and conversation

- **Shipped:** Ask, Plan, Debug, Agent, provider-aware reasoning and context
  controls, managed or local-key routing, workspace tools, terminal, Git, MCP,
  health/calendar/email
  tools, attachments, checkpoints, stop/cancel, persistent sessions, queued
  messages, priority interruption, queue reordering, durable side
  conversations, editable and resendable user messages, conversation/history
  search, persistent sidebar/header/command access to Chat history, responsive
  non-overlapping conversation controls, named Agent activity and concise
  decision rationales, elapsed work status, bounded local-only live previews for
  file searches, reads, diffs, terminal output, browser state, and automatic
  final synthesis after long tool runs, editable plans with Build and workspace
  save actions, context usage inspection, durable memory, and an approval-mode
  favorite persisted locally across restarts.
- **Tab recovery boundary:** the user turn is saved before provider execution;
  closing or switching the Agent surface does not cancel the in-flight request,
  and reopening targets the exact session with a background-running banner.
  This does not claim execution survives application quit or renderer failure.
- **Preview boundary:** local previews strip terminal controls, bidirectional
  controls, private keys, credential-like tokens, and secret assignments; typed
  browser text is represented only by target and character count. Source and
  command previews are never written to Firestore.
- **Context boundary:** Work Agents cannot access health, calendar, inbox, or
  personal-memory tools. Personal Agents do not load project files, terminal,
  Git, MCP, browser automation, or workspace instructions. Explicit chat file
  attachments remain user-directed exceptions.
- **Partial:** no transcript sharing, voice input, or selectable
  compact/balanced/detailed tool presentation.
- **Next local:** voice capture, transcript sharing, and activity-density
  controls.

## 7. Review, diffs, Git, and pull requests

- **Shipped:** status, staged/unstaged diff reading, stage/unstage all,
  approval-bound commits, mutation refresh, checkpoints, approval records,
  first-class GitHub workspace navigation, searchable/recent repository
  selection, remembered repository/branch/file context, and explicit
  side-by-side GitHub diff review before remote commit. Dirty drafts block file,
  branch, repository, disconnect, and page-leave transitions until confirmed.
- **Partial:** branch, blame, pull-request review, and split-PR workflows are
  absent.
- **Next local:** complete review surface with branch,
  pull-request tabs, focused review, and dependency-aware change grouping.
- **Service-dependent:** provider-hosted review comments, merge, analytics, and
  automatic pull-request agents.

## 8. Visual design mode

- **Next local:** embedded local-site preview, element selection, screenshot
  context, multi-select, frozen-frame markup, and prompt handoff.
- **Security requirement:** origin allowlist, isolated browser sessions, visible
  automation state, and no hidden credential access.

## 9. Interactive canvases

- **Shipped:** Plan mode creates durable local planning canvases with stable
  identity and revisions; rendered/source views; interactive checklists;
  bounded flow diagrams; chat cards; reopen/library controls; independent fork
  copies; conversational refinement; explicit conflict-checked workspace
  files; and immutable Start-plan handoff.
- **Partial:** canvases are planning artifacts rather than arbitrary dashboards;
  direct visual annotation, live data refresh, and shareable snapshots are
  absent.
- **Next local:** prompt-triggering controls, visual annotations, reusable
  non-plan artifact schemas, and explicit private sharing.
- **Service-dependent:** public snapshots, shared team gallery, and hosted data
  refresh.

## 10. Browser tooling

- **Shipped:** a first-class Browser workspace; multiple visible isolated tabs;
  exact-URL and address/search opening; back, forward, reload, activation, and
  close controls; bounded page text and opaque element snapshots; screenshots;
  click and non-secret typing; per-conversation tab ownership; stale-reference
  rejection; isolated cookies; blocked password fields, downloads, popups,
  permissions, insecure public HTTP, and private-network destinations;
  constrained application listing and launch.
- **Partial:** no select/drag/scroll primitives, console/network inspector, or
  native-application UI automation.
- **Next local:** local-site discovery, additional browser gestures, deeper
  browser inspection, and capability-scoped native application adapters.
- **Security requirement:** browser and application actions follow the active
  review policy; page content and pixels remain untrusted evidence, tab access
  is scoped to the owning conversation, and personal browser sessions are never
  reused.

## 11. Terminal and execution security

- **Shipped:** Review each, Auto-review, and Run everything modes; exact
  operation dialogs; canonical workspace containment; symlink escape
  protection; external-file protection; deletion approval; checkpoints;
  command/MCP/hook approval; protected renderer IPC.
- **Partial:** Auto-review is policy-driven but not an OS-level sandbox with
  network/path policy; no plain-language permissions file UI.
- **Next local:** macOS/Windows sandbox adapters, network controls,
  project/user permission files, protected configuration paths, and visible
  policy explanations.
- **Excluded:** silent unrestricted execution as a default.

## 12. Parallel work

- **Shipped:** bounded subagent tool rounds, two concurrent read-only
  investigations with separately visible provenance, up to two simultaneous
  top-level Agent runs across separate tabs, and a Task Workspaces
  surface for creating, opening, and safely removing Git worktrees from a
  clean committed baseline without touching or silently omitting main-workspace
  changes.
- **Partial:** no durable dependency graph, background task IDs, resumable write
  agents, branch-apply workflow, or best-of-N review.
- **Next local:** durable task cards, dependency-aware execution, resumable
  agents, explicit review/apply, and best-of-N comparison.
- **Service-dependent:** handoff to hosted VMs and laptop-closed execution.

## 13. Customization hub

- **Shipped:** one Customize surface discovers and explains workspace rules,
  skills, hook files, MCP configuration, and connected tools.
- **Partial:** user/team scope, Commands, custom Agents, Plugins, editing, and
  marketplace installation remain incomplete.
- **Next local:** searchable User/Workspace scope with Commands, Agents,
  Plugins, editing, and provenance review.
- **Service-dependent:** team marketplace, organization distribution, and
  popularity analytics.
- **Excluded:** installing unreviewed executable plugins without provenance and
  explicit permission review.

## 14. Hooks

- **Shipped:** session start/end, before prompt, after response, file read,
  workspace mutation, terminal, MCP, and configured workspace hooks with
  approval and content-hash identity.
- **Partial:** event coverage, matchers, prompt-evaluated hooks, fail-closed
  policy, output logs, and loop limits are incomplete.
- **Next local:** normalized event contract, hook inspector/log, matchers,
  timeout/failure policy, and follow-up events.

## 15. Model Context Protocol

- **Shipped:** stdio, SSE, and Streamable HTTP transport; local/remote server
  discovery; tool listing/calls; exact-argument approval;
  cancellation/error isolation; and Agent tool integration.
- **Partial:** full configuration editing, OAuth, prompts, resources, roots,
  elicitation, interactive apps, and logs are incomplete.
- **Next local:** full transport/configuration surface, per-tool controls,
  OAuth handoff, logs, and interactive responses.
- **Service-dependent:** team allowlists and managed marketplace distribution.

## 16. Models and routing

- **Shipped:** precise model, effort, context, reasoning mode, managed/direct
  route, encrypted local keys, Anthropic/OpenAI/Google/xAI/Azure/Bedrock and
  compatible providers, streaming, cancellation, and subagent rounds.
- **Partial:** no cost/balance/intelligence router, per-request cost estimate,
  spend alerts, or organization policy.
- **Next local:** transparent route recommendation, request estimate, local
  budgets, and model capability diagnostics.
- **Service-dependent:** pooled organization usage and centrally enforced model
  policy.

## 17. Hosted agents

- **Partial:** GitHub-backed browser workspaces and an isolated Workbench
  backend exist; there are no durable build VMs.
- **Service-dependent:** environments, snapshots, secrets, remote desktop,
  artifacts, durable multi-hour agents, sharing, and private networking.
- **Product rule:** local capability must remain first-class even when hosted
  execution is added.

## 18. Automations

- **Service-dependent:** schedules, repository events, chat events, incidents,
  webhooks, durable memory, and always-on execution.
- **Next local:** safe foreground recurring tasks while the desktop app is
  running, with visible schedule, next run, history, and stop controls.

## 19. Review and security agents

- **Partial:** review prompts, Git diff tools, Agent protections, and security
  review architecture exist; no complete local review product surface.
- **Next local:** quick/deep code review, security review, finding lifecycle,
  patch identity, accepted/dismissed state, and fix handoff.
- **Service-dependent:** pull-request bots, hosted scanners, analytics, and
  organization approval routing.

## 20. Mobile, web, and work integrations

- **Shipped:** iOS health product, browser app, Google Calendar read/create,
  Gmail read/send, universal calendar files, local notifications, GitHub-backed
  browser edits, active iOS meal-plan and fitness-plan parity in desktop Plan,
  combined weekly calendar/meal/fitness view, and a separate Email Agent entry.
- **Privacy boundary:** inbox/calendar tool arguments are redacted from stored
  evidence; connected-service answers remain memory-only and are replaced with
  a privacy notice in persisted chat history. Email sends and calendar creates
  remain exact-payload, expiring, server-owned approvals.
- **Partial:** mobile and desktop do not share a unified Agent task lifecycle;
  Google Drive, Microsoft direct calendar/email, and desktop remote control are
  absent.
- **Service-dependent:** Slack, Teams, Jira, Linear, source-control comment
  triggers, push/live activities, and remote desktop control.

## 21. Command-line client

- **Next local:** interactive/headless Agent, Ask/Plan/Agent modes, resume,
  structured output, sandbox controls, worktree handoff, and clipboard files.
- **Security requirement:** shares the desktop approval/policy engine rather
  than creating a second execution boundary.

## 22. SDK and API

- **Next local:** TypeScript/Python local runtime, streaming, cancellation,
  custom tools, stores, checkpoints, model listing, and request correlation.
- **Service-dependent:** durable hosted Agent API, webhooks, and cloud task
  lifecycle.

## 23. Teams and enterprise

- **Partial:** enterprise routes, isolated Workbench backend, consent controls,
  server-only secrets, audit-oriented action state, and billing separation.
- **Service-dependent:** SSO/OIDC, SCIM/groups, analytics, budgets, central
  provider policy, team rules/plugins/MCP, privacy modes, BAA operations, and
  service accounts.

## 24. Indexing and context

- **Shipped:** health-record indexing; asynchronous multi-root workspace index;
  file/path, literal, symbol, and local fuzzy ranking; incremental
  size/mtime reuse; encrypted on-disk cache; visible progress/status; bounded
  live previews; `.gitignore`, `.cursorignore`, and default secret exclusions;
  explicit attachments; local file references; and per-turn context reports.
- **Partial:** local fuzzy ranking is private feature hashing rather than
  semantic embeddings; external file changes reconcile every minute rather than
  through a filesystem watcher; no team sharing or detailed ignore diagnostics.
- **Next local:** optional local/provider embeddings, watcher-driven
  invalidation, index diagnostics, and measured retrieval evaluation.
- **Service-dependent:** permission-aware shared team indexes.

## 25. Keyboard interaction

- **Shipped:** global Agent summon, command palette, workspace search, Explorer,
  terminal, Agent, save, inline edit, conversation search, mode/model cycling,
  full-screen editor focus, tab navigation, queue/priority send, and standard
  Monaco shortcuts.
- **Partial:** voice, output/log panel, and remapping are incomplete.
- **Next local:** one searchable shortcut map, consistent macOS/Windows labels,
  remapping, conflict detection, and shortcut hints only where useful.

## 26. Release evolution

- **Shipped:** client self-updater, quiet periodic checks, explicit
  download/restart, immutable architecture feeds, checksums, resumable
  publishing, and end-to-end update verification.
- **Partial:** platform distribution certificates and notarization remain
  external prerequisites; release notes and staged rollout controls are not
  yet surfaced.
- **Next local:** release notes, channels, phased rollout, rollback metadata,
  and update health diagnostics.

## Immediate local sequence

1. Embedded browser with visual selection and evidence capture.
2. Durable task dependency graph and review/apply orchestration.
3. Branch, pull-request, blame, and focused review tabs.
4. Predictive-edit lifecycle controls and cross-file next edits.
5. Optional embeddings plus retrieval quality evaluation.
6. Customize editing, logs, user scope, custom Agents, and Plugins.
7. CLI/SDK sharing the same local execution and approval runtime.

Cloud-dependent items remain accounted for here, but they do not block the
local product from becoming complete.
