# Deploying the StatsKey website

The live site **auto-deploys from GitHub `origin/main`**. A push to `main` is a
deploy. Nothing that is only on your laptop (uncommitted files, a second clone,
or a manual `vercel` upload) is the source of truth — `origin/main` is.

## The one rule

> **Edit → commit → push → verify the deploy.**

If a change is not committed and pushed to `origin/main`, it will not stay live.
A later Git deploy will rebuild `origin/main` and "overwrite" anything that only
existed in your working tree.

## Before you count on a deploy

```bash
npm run check:deploy
```

This verifies that what you have locally is exactly what will deploy:

- no uncommitted/untracked work left behind,
- you are not **behind** `origin/main` (i.e. another machine pushed work you
  don't have), and
- you have nothing committed-but-unpushed.

It exits non-zero and tells you exactly what to do if you're not ready.

## Do not mix deploy methods

- **Preferred:** commit + `git push origin main`, then watch the Vercel
  deployment for that commit finish, then hard-refresh the page.
- **Avoid** `vercel --prod` from this folder. It uploads your *working tree*
  (including uncommitted drafts), so the site looks correct for a moment — then
  the next Git deploy reverts it to `origin/main`. If you ever must use it, run
  `npm run check:deploy` first so the working tree already matches `origin/main`.

## Avoid a second diverging environment

If you work from more than one machine/clone, **`git pull` before you start** and
**push when you finish**. If `check:deploy` says you are "behind", run:

```bash
git pull --no-rebase origin main
```

…to integrate the other environment's work before pushing, so the two never
diverge again.

## Big binaries

Local CAD/3D sources under `public/guitar/brand manufactured models/` and any
`*.stp` / `*.step` files are git-ignored — they are not used by the site and
would bloat the repo. Keep them locally; don't force them into git. If a 3D
source ever needs to ship, host it externally or use Git LFS rather than
committing it directly.
