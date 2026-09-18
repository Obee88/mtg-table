---
name: go-next
description: Implement the next unchecked item in _documents/plan.md, push it to main, wait for CI and the deploy workflows to go green, and verify the new sha is live on mtg.codes.hr / api.mtg.codes.hr. One item per invocation.
---

# go-next

Take exactly one item from the **Progress** section of `_documents/plan.md`, ship it, and prove it is deployed.

## 1. Pick the item

- Ensure `git status` is clean and you are on `main`; run `git pull --ff-only origin main`.
- Read `_documents/plan.md` → **Progress**. The target is the **first** `- [ ]` item in document order. Never skip ahead; milestones are ordered on purpose.
- If the item is too big for one run, split it in place into smaller `- [ ]` sub-items (keeping the order) and take the first sub-item. Do the split in the same commit as the work.
- If the item needs a decision only the user can make, ask with AskUserQuestion **before** writing code. Otherwise make the routine calls yourself, following `plan.md` / `deployment.md` / `CLAUDE.md`.

## 2. Implement

- Follow the architecture in `plan.md` (event-sourced rooms, visibility projection, shared reducers in `packages/shared`, phase-plugin draft engine). Do not invent a parallel design.
- Schema changes: edit `apps/api/src/db/schema.ts`, then `pnpm --filter @mtg/api db:generate`, and commit the migration.
- Add tests for anything with logic: pure logic in `packages/shared` (vitest), API routes via the PGlite harness in `apps/api/src/test/`.
- If the work changes a decision recorded in the docs, update the doc in the same commit.

## 3. Verify locally — all must pass

```
pnpm --filter @mtg/shared build && pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Fix everything before moving on. No `--no-verify`, no skipped tests.

## 4. Mark done and push

- Change the item to `- [x]` in `plan.md`.
- Commit everything with message `M<n>: <item text>` (add a body if useful) and the standard `Co-Authored-By` trailer. Then `git push origin main`. Never force-push.

## 5. Wait for green

Poll until no run for this commit is `queued`/`in_progress`:

```
gh run list --limit 6 --json databaseId,name,status,conclusion,headSha
```

Runs to expect: `ci` always; `deploy-api` if `apps/api/**`, `packages/**`, root manifests or its workflow changed; `deploy-web` likewise for `apps/web/**`.
If any run fails: `gh run view <id> --log-failed`, fix the cause, push again (same item, new commit), and wait again. Do not mark the item done in your report until everything is green.

## 6. Verify the deployment

The workflows pass the 12-char short sha into both images. After the deploy runs succeed, poll (up to ~5 minutes, every 15 s) until the live sha equals `git rev-parse --short=12 HEAD`:

- API deployed → `curl -s https://api.mtg.codes.hr/healthz` returns `{"ok":true,"sha":"<sha>"}`, and `curl -s https://api.mtg.codes.hr/readyz` returns `db: "up"`.
- Web deployed → `curl -s https://mtg.codes.hr/version.txt` returns `<sha>`.
- A run that was path-filtered out leaves its service on the previous sha; that is expected — only check the services whose deploy ran.

If the sha never appears, the dashboard rolled back or the container is unhealthy: say so plainly with what you observed; do not claim it deployed.

## 7. Report

State: the item implemented, notable decisions, the commit sha, the workflow results, the verified live shas, and the next `- [ ]` item. If anything was left out or is unverified, say exactly what.
