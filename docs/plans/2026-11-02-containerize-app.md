# Containerize the App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One command runs the app at `http://localhost:8080` from a container, and a dependency bump that breaks the app fails CI instead of reaching `main`.

**Architecture:** Express serves the built Vite frontend and `/api` from one origin, packaged as a single multi-stage Docker image started by `docker compose` with secrets from Doppler. CI adds a React version check, runs the existing vitest suite, and a Playwright smoke job against the built container with Gemini mocked. A workflow auto-merges passing patch/minor bot PRs.

**Tech Stack:** Node 22, Express, React 19, Vite, pnpm 11 (`packageManager`), vitest, Playwright, Docker / compose, GitHub Actions, Doppler.

**Spec:** `docs/specs/2026-11-02-containerize-app-design.md`

## Execution rules (this repo)

- Base: branch `chore/containerize-app` from upstream `main` (535bc6e). Task 0 creates it.
- **Workers never commit.** A worker edits files in its worktree, runs the task's checks, and reports PASS/FAIL per check with output. The orchestrator verifies, then commits with the task's commit message. "Commit" steps below are orchestrator steps.
- Tasks run in order; each depends on the previous one's files.

## Global Constraints

- Model id: `gemini-3.5-flash-lite` (frontend and server allowlist), nothing else.
- Container listens on `8080`; compose publishes `${BIND_ADDRESS:-127.0.0.1}:${HOST_PORT:-8080}:8080`.
- Dev ports: server `3001`, Vite `3000` with `strictPort: true`.
- Doppler: dev `--project tfl --config dev`; container `--project tfl --config prd`. Never print, write or commit a secret value.
- `react` and `react-dom` pinned to the same exact version, no range operator.
- pnpm version comes only from `packageManager`; Node version only from `.node-version`.
- Image runs as non-root `node`; no secrets in the image or bundle.
- Auto-merge: patch and minor only; majors and unparseable versions get label `needs-review`.
- No new runtime dependencies. New dev dependency allowed: `@playwright/test`.

## Review Focus

1. Deep link or refresh on a non-root path in production returns the app, not a 404 (SPA fallback) — Task 1 test `serves index.html for unknown GET paths`.
2. `/api/unknown` in production returns 404 JSON, not `index.html` (fallback must not swallow API misses) — Task 1 test `does not fall back for /api paths`.
3. Container started without `GEMINI_API_KEY` exits with a clear error instead of serving a page whose uploads all fail — Task 2 check step.
4. A Snyk PR bumping only `react-dom` (mismatch) fails CI — Task 3 test `fails when react and react-dom differ`.
5. A Snyk PR title the parser cannot read is labelled `needs-review`, never auto-merged — Task 5 test `unparseable title is not auto-merged`.

---

### Task 0: Branch setup (orchestrator)

- [ ] **Step 1:** Confirm git is unblocked: `git status` succeeds.
- [ ] **Step 2:** Preserve local leftovers: move `docs/specs/2026-11-02-containerize-app-design.md` and this plan to `$TMPDIR`; `git stash push -u -m "pre-containerize local state"` (stale `package.json`/`pnpm-lock.yaml`, `services/geminiService.ts`, `.playwright-mcp/`). Report the stash to the owner; do not drop it.
- [ ] **Step 3:** `git fetch origin && git switch -c chore/containerize-app origin/main`; restore the spec and plan files.
- [ ] **Step 4:** `pnpm install --frozen-lockfile && pnpm test && pnpm build` — record the baseline (expect PASS; if not, stop and report).
- [ ] **Step 5: Commit** `docs: add containerize-app spec and plan`

---

### Task 1: Same-origin server, model and scripts

**Files:**

- Modify: `server/index.js`, `server/index.test.js`, `services/geminiService.ts`, `services/geminiService.test.ts`, `services/langfuseService.ts`, `vite.config.ts`, `package.json` (scripts, remove `cors`, `@types/cors`)

**Interfaces:**

- Produces: `createApp({ geminiApiKey, fetchImpl, retryOptions, responseCache, staticDir })` — new optional `staticDir: string | undefined`; when set, serves it statically with SPA fallback. Entry point sets `staticDir` to `<repo>/dist` when `NODE_ENV === "production"`. `PORT` default: `8080` in production, `3001` otherwise.
- Produces: scripts `dev`, `start`, `build`, `test` exactly as in spec section 1. `start` = `NODE_ENV=production node server/index.js`.
- Frontend calls `/api/gemini/generateContent` and `/api/langfuse/traces` (relative) in all modes.

- [ ] **Step 1: Write failing tests** in `server/index.test.js` (use a temp dir with an `index.html` containing `<div id="root"></div>` and `assets/app.js`):
  - `serves index.html at /` → 200, body contains `id="root"`.
  - `serves static assets` → `GET /assets/app.js` 200.
  - `serves index.html for unknown GET paths` → `GET /some/deep/link` 200, body contains `id="root"`.
  - `does not fall back for /api paths` → `GET /api/unknown` 404, `content-type` JSON.
  - `serves no static files when staticDir is unset` → `GET /` 404.
  - `accepts gemini-3.5-flash-lite` and `rejects gemini-3.1-flash-lite` with 400 `Unsupported model`.
  - Update `validRequest.model` and any test expecting CORS headers.
- [ ] **Step 2:** `pnpm test server` → new tests FAIL.
- [ ] **Step 3:** Implement in `server/index.js`: `staticDir` option (`express.static`, then a `GET` fallback to `index.html` that skips `/api` and `/health`, and a JSON 404 for unmatched `/api/*`); `ALLOWED_GEMINI_MODELS = new Set(["gemini-3.5-flash-lite"])`; remove `cors` and `FRONTEND_ORIGIN` (and its startup log line); production `PORT`/`staticDir` wiring at the entry point.
- [ ] **Step 4:** Frontend: `API_BASE_URL = "/api"` constant in `services/geminiService.ts` (drop `VITE_API_BASE_URL` and the PROD branch; keep `buildGenerateContentUrl` and update its tests); model constant `gemini-3.5-flash-lite`; `services/langfuseService.ts` endpoint always `/api/langfuse/traces`; `vite.config.ts` proxy target fixed `http://localhost:3001`. `grep -rn VITE_API_BASE_URL --exclude-dir=node_modules .` returns nothing outside `docs/`.
- [ ] **Step 5:** `package.json` scripts per spec table; `pnpm remove cors @types/cors`.
- [ ] **Step 6: Verify:** `pnpm test`, `pnpm lint`, `pnpm type-check`, `pnpm build` PASS. Then `pnpm build && GEMINI_API_KEY=dummy PORT=8099 NODE_ENV=production node server/index.js` and `curl -s localhost:8099/ | grep 'id="root"'` and `curl -s localhost:8099/health` → both succeed. `pnpm dev` starts both processes (Vite on 3000) — orchestrator confirms page loads in Playwright with zero console errors.
- [ ] **Step 7: Commit** `feat: serve frontend and API from one origin`

---

### Task 2: Container

**Files:**

- Create: `Dockerfile`, `.dockerignore`, `compose.yaml`, `.node-version`, `.env.example`
- Modify: `.gitignore` (confirm `.env` ignored; it is)

**Interfaces:**

- Consumes: `pnpm build`, `pnpm start` from Task 1.
- Produces: image listening on `8080`, `HEALTHCHECK` on `/health`; compose service `app`.

- [ ] **Step 1:** `.node-version` = the Node 22 LTS version currently in CI (`22.13.0`) or newer 22.x patch; Dockerfile `ARG NODE_VERSION` matching it, base `node:${NODE_VERSION}-slim`.
- [ ] **Step 2:** Dockerfile stages per spec section 2: `corepack enable`; `pnpm install --frozen-lockfile`; `pnpm build`; runtime copies prod deps (`pnpm install --prod --frozen-lockfile` or `pnpm prune --prod`), `dist/`, `server/`, `package.json`; `USER node`; `ENV NODE_ENV=production PORT=8080`; `EXPOSE 8080`; `HEALTHCHECK CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`; `CMD ["node","server/index.js"]`. Husky `prepare` must not fail in the image (`HUSKY=0` or `--ignore-scripts` for the prod install).
- [ ] **Step 3:** `.dockerignore` per spec. `compose.yaml` per spec (service `app`, `build: .`, `restart: unless-stopped`, ports line from Global Constraints, env pass-through of `GEMINI_API_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`). `.env.example` lists those plus `HOST_PORT` and `BIND_ADDRESS`, values empty.
- [ ] **Step 4: Verify:**
  - `docker build -t tfl-app:test .` succeeds on the Pi (arm64).
  - `docker run --rm tfl-app:test` without `GEMINI_API_KEY` exits non-zero with `GEMINI_API_KEY environment variable is not set`.
  - `docker run -d --name tfl-smoke -e GEMINI_API_KEY=dummy -p 127.0.0.1:8098:8080 tfl-app:test`; within 30 s `docker inspect -f '{{.State.Health.Status}}' tfl-smoke` = `healthy`; `curl -s localhost:8098/ | grep 'id="root"'` succeeds; `docker exec tfl-smoke whoami` = `node`; `docker rm -f tfl-smoke`.
  - `docker history --no-trunc tfl-app:test` and `grep -r GEMINI dist/` show no secret values.
- [ ] **Step 5: Commit** `feat: add Dockerfile and compose for self-hosting`

---

### Task 3: Update dependencies and lock React together

**Files:**

- Create: `scripts/check-react-versions.mjs`, `scripts/check-react-versions.test.mjs`
- Modify: `package.json`, `pnpm-lock.yaml` (via pnpm only), `pnpm-workspace.yaml` (if `allowBuilds`/overrides need updating), `.github/dependabot.yml`, any source a major bump requires

**Interfaces:**

- Produces: `checkReactVersions(rootDir: string): { ok: boolean, react: string, reactDom: string }` exported from `scripts/check-react-versions.mjs`; run as a CLI it prints both versions and exits 1 on mismatch.

- [ ] **Step 1: Write failing tests** (`scripts/check-react-versions.test.mjs`, temp dirs with fake `node_modules/react/package.json` and `node_modules/react-dom/package.json`):
  - `passes when react and react-dom match` → `ok: true`.
  - `fails when react and react-dom differ` (`19.3.1` vs `19.2.3`) → `ok: false`, both versions returned.
- [ ] **Step 2:** Run → FAIL. Implement. Run → PASS. Make sure vitest picks up `scripts/**/*.test.mjs` (adjust vitest include if needed).
- [ ] **Step 3:** `pnpm outdated`, then `pnpm update --latest`. For every major bump, read its changelog/migration guide and fix code until `pnpm lint && pnpm type-check && pnpm test && pnpm build` pass. Remove any dependency `grep` shows unused (report each removal). If a major cannot be adopted cleanly, stop and report which and why — do not pin it back silently.
- [ ] **Step 4:** Pin `react` and `react-dom` to the same exact latest version (`pnpm add react@X react-dom@X --save-exact`). `node scripts/check-react-versions.mjs` exits 0.
- [ ] **Step 5:** `.github/dependabot.yml`: add group `react` (patterns `react`, `react-dom`, `@types/react`, `@types/react-dom`) listed before the existing groups; keep weekly schedule and the prod/dev groups.
- [ ] **Step 6: Verify:** `pnpm install --frozen-lockfile` clean; full checks PASS; Task 2 container builds and turns healthy; orchestrator loads the page in Playwright with zero console errors and processes `sample/...Journeys).pdf` through the real Gemini key once (manual, with Doppler `tfl/dev`).
- [ ] **Step 7: Commit** `chore(deps): update all dependencies and pin React in lockstep`

---

### Task 4: Smoke tests and CI gates

**Files:**

- Create: `playwright.config.ts`, `tests/e2e/smoke.spec.ts`, `tests/e2e/fixtures/gemini-extraction.json`, `tests/e2e/fixtures/statement.png`
- Modify: `package.json` (`test:e2e`, `@playwright/test`), `.github/workflows/ci.yml`, `.github/workflows/snyk.yml`, vitest/eslint config to exclude `tests/e2e`

**Interfaces:**

- Consumes: image from Task 2, `scripts/check-react-versions.mjs` from Task 3.
- Produces: `pnpm test:e2e` reads `BASE_URL` (default `http://127.0.0.1:8080`); CI jobs named exactly `ci` and `smoke`.

- [ ] **Step 1:** `statement.png`: render page 1 of `sample/Amex - 2003 - October 2025 (Journeys).pdf` at 150 dpi (e.g. `pdftoppm -png -r 150 -f 1 -l 1`), commit the PNG. `gemini-extraction.json`: a valid response for the app's extraction schema (see `types.ts` `TravelEntry` and the `responseSchema` in `services/geminiService.ts`) with two journeys on two weekdays in October 2025, wrapped as the server returns it: `{ "text": "<JSON string>", "response": {} }`.
- [ ] **Step 2: Write tests** in `tests/e2e/smoke.spec.ts` (Chromium; fail on any `console` error or `pageerror`):
  - `home page renders without errors` → heading `TfL journey expense calculator` visible.
  - `pdf upload produces a report` → route `**/api/gemini/generateContent` to the fixture; upload the sample PDF; select the two fixture dates in the calendar; click `Calculate expenses`; `#step-3-summary` shows the sum of the two fixture fares.
  - `image upload produces a report` → same with `statement.png`.
  - Route `**/api/langfuse/traces` to 204 so tracing never leaves the runner.
- [ ] **Step 3:** Run locally against the Task 2 container (`BASE_URL=http://127.0.0.1:8098 pnpm test:e2e`) → PASS. Then prove the gate: temporarily install `react-dom` one patch behind `react`, rebuild the image, rerun → `home page renders without errors` FAILS; revert.
- [ ] **Step 4:** `ci.yml`: job `ci` = checkout, `pnpm/action-setup` (no `version`), `setup-node` with `node-version-file: .node-version` and pnpm cache, `pnpm install --frozen-lockfile`, format check, lint, type-check, `node scripts/check-react-versions.mjs`, `pnpm test`, `pnpm build`. Job `smoke` (`needs: ci`) = docker build, run with `GEMINI_API_KEY=dummy` on `127.0.0.1:8080`, wait for healthy (fail after 60 s), `pnpm exec playwright install --with-deps chromium`, `pnpm test:e2e`, upload Playwright report on failure, always print container logs.
- [ ] **Step 5:** `snyk.yml`: same version sources; `snyk/actions/node` pinned to its latest release tag.
- [ ] **Step 6: Verify:** `actionlint` (or `docker run --rm -v $PWD:/repo -w /repo rhysd/actionlint`) clean; all local checks PASS. CI itself is verified on the PR (orchestrator).
- [ ] **Step 7: Commit** `ci: add smoke tests against the container and React version gate`

---

### Task 5: Auto-merge bot PRs

**Files:**

- Create: `.github/workflows/auto-merge.yml`, `scripts/bump-type.mjs`, `scripts/bump-type.test.mjs`

**Interfaces:**

- Produces: `bumpType(title: string): "patch" | "minor" | "major" | null` — parses Snyk titles like `[Snyk] Upgrade react from 19.2.0 to 19.2.1`; `null` when it cannot parse.

- [ ] **Step 1: Write failing tests:**
  - `[Snyk] Upgrade express from 4.21.2 to 4.22.1` → `minor`; `... 19.2.0 to 19.2.1` → `patch`; `... 4.4.2 to 5.0.0` → `major`.
  - `unparseable title is not auto-merged` → `[Snyk] Security upgrade multiple packages` → `null`.
  - Prerelease `1.0.0 to 1.1.0-beta.1` → `null`.
- [ ] **Step 2:** Run → FAIL; implement; run → PASS.
- [ ] **Step 3:** Workflow on `pull_request_target` (`opened`, `synchronize`, `reopened`), `permissions: contents: write, pull-requests: write`, runs only if `github.event.pull_request.user.login` is `dependabot[bot]` or `snyk-bot`. Checks out the **base** branch only (never PR code). Dependabot: `dependabot/fetch-metadata` (pinned) → `update-type`. Snyk: `node scripts/bump-type.mjs "$TITLE"` with the title passed via `env`, never interpolated into the script. Patch/minor → `gh pr merge --auto --squash "$PR_URL"`; else `gh pr edit --add-label needs-review`.
- [ ] **Step 4: Verify:** tests PASS; `actionlint` clean; reviewer confirms no PR-controlled string reaches a shell unquoted.
- [ ] **Step 5: Commit** `ci: auto-merge passing patch and minor bot PRs`

---

### Task 6: Docs and owner handoff

**Files:**

- Modify: `README.md` (run and deploy sections only)

- [ ] **Step 1:** README per spec section 6: `pnpm dev`; `doppler run --project tfl --config prd -- docker compose up -d`; `.env` route for non-Doppler users (`cp .env.example .env`); env var table (`GEMINI_API_KEY` required; `LANGFUSE_*` optional; `HOST_PORT`, `BIND_ADDRESS`, `TRUST_PROXY_HOPS`); note that `BIND_ADDRESS=0.0.0.0` exposes the app to the network.
- [ ] **Step 2:** Orchestrator writes the owner handoff in the PR body: create Doppler `tfl/prd`; delete `VITE_API_BASE_URL` from `tfl/dev`; enable "Allow auto-merge"; branch protection command:
      `gh api -X PUT repos/crypticseeds/tfl-journey-expense-calculator/branches/main/protection --input protection.json` with required checks `ci`, `smoke`; close #37 and #40 after merge; on the Pi set `BIND_ADDRESS=0.0.0.0` in `.env` for LAN access.
- [ ] **Step 3: Verify:** `pnpm format` leaves the tree clean; links in README resolve.
- [ ] **Step 4: Commit** `docs: document dev and self-hosted runs`

---

### Final verification (orchestrator)

- [ ] Whole-branch review by `code-reviewer` (Opus); security pass on Tasks 2 and 5.
- [ ] On the Pi: `doppler run --project tfl --config prd -- docker compose up -d --build`; Playwright loads `http://localhost:8080` with zero console errors; one real PDF processed end to end.
- [ ] Push branch, open PR, confirm `ci` and `smoke` green.
