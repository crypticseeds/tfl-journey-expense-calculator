# Containerize the app and make dependency bumps safe

Date: 2026-11-02
Branch: `chore/containerize-app`, cut from upstream `main` (535bc6e)
Status: decisions agreed 2026-11-02 (bind 127.0.0.1 by default, image
OCR in smoke test, auto-merge patch + minor); awaiting final approval

## Goal

Anyone, including the owner, can start the app with one command and
use it at `http://localhost:<port>`. A dependency bump (from Snyk or
Dependabot) that breaks the app fails CI and never reaches `main`.

### Success criteria

1. `doppler run --project tfl --config prd -- docker compose up -d` on the
   Pi serves the working app (page renders, upload of the sample PDF
   produces a report) at `http://localhost:8080`. It comes back by itself
   after a reboot.
2. `pnpm dev` starts a working dev environment in one command, with no
   manual env setup beyond Doppler access.
3. A PR that installs mismatched `react`/`react-dom` versions fails CI,
   and so does any PR where the page throws a console error on load or
   the mocked upload flow fails.
4. All dependencies are at their latest versions; CI is green.
5. Passing Dependabot and Snyk PRs for patch/minor bumps merge
   automatically; majors wait for the owner.
6. No secret (Gemini, Langfuse) appears in the built frontend bundle,
   the image, or the repo.

## Context (what `main` already has)

Verified against upstream `main` at 535bc6e:

- Server (`server/index.js`) sends the Gemini key as the `x-goog-api-key`
  header, hides Gemini error bodies, supports `TRUST_PROXY_HOPS`,
  restricts models to an allowlist, and relays Langfuse traces at
  `/api/langfuse/traces` using server-side keys. The Langfuse secret is
  no longer in the browser bundle.
- Tailwind is built (PostCSS), not loaded from the CDN.
- vitest is installed with `pnpm test`, but CI never runs it.
- `packageManager: pnpm@11.22.0`; `pnpm-workspace.yaml` holds
  `allowBuilds` and `overrides`. CI and the Snyk workflow hard-code the
  pnpm and Node versions separately.
- `react` is `^19.2.1` and `react-dom` is `^19.2.3`: independent ranges,
  so the mismatch that blanked the page on 2026-11-01 can recur.
- Open bot PRs: #37 (16 production updates), #40 (19 dev updates).

## Design

### 1. One process, one origin

Express serves the built frontend and the API from the same origin.

- In production, `server/index.js` serves `dist/` as static files and
  falls back to `dist/index.html` for non-API `GET` requests. `/api/*` and
  `/health` behave as today.
- The frontend always calls the relative path `/api`. Remove
  `VITE_API_BASE_URL` from `services/geminiService.ts`,
  `services/langfuseService.ts`, `vite.config.ts` (proxy target becomes
  fixed `http://localhost:3001`), docs and Doppler.
- Remove the `cors` middleware, the `cors` and `@types/cors` dependencies
  and `FRONTEND_ORIGIN`. Nothing is cross-origin any more.
- Model: `gemini-3.5-flash-lite` in both `services/geminiService.ts` and
  the server's `ALLOWED_GEMINI_MODELS`.
- `PORT` defaults to `8080` in production (the container), `3001` in dev.

Scripts:

| Script          | Does                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `pnpm dev`      | `doppler run --project tfl --config dev -- concurrently` server (3001) + Vite (3000, `strictPort`) |
| `pnpm build`    | `vite build` (unchanged)                                                                           |
| `pnpm start`    | `NODE_ENV=production node server/index.js`, serving `dist/`                                        |
| `pnpm test`     | vitest (unchanged)                                                                                 |
| `pnpm test:e2e` | Playwright smoke test against a running server                                                     |

The `dev:server`, `dev:frontend`, `dev:all` and `dev:all:doppler`
scripts are removed in favour of the single `pnpm dev`. Naming
the Doppler project and config in the script fixes the 2026-11-01
problem where this folder resolved to the wrong Doppler project.

### 2. Container

- `Dockerfile`, multi-stage, base `node:<version>-slim` pinned by
  `.node-version`:
  1. `deps`: corepack enables the pnpm from `packageManager`;
     `pnpm install --frozen-lockfile`.
  2. `build`: `pnpm build`.
  3. `runtime`: production dependencies only, `dist/` and `server/`;
     runs as the non-root `node` user; `EXPOSE 8080`;
     `HEALTHCHECK` calls `/health` with Node (no curl in the image).
- `.dockerignore` excludes `node_modules`, `.git`, `dist`, `.env*`,
  `docs`, `sample`, `images`, agent folders.
- `compose.yaml`: one service, `build: .`, `restart: unless-stopped`,
  `ports: "${BIND_ADDRESS:-127.0.0.1}:${HOST_PORT:-8080}:8080"`,
  environment passes through `GEMINI_API_KEY`, `LANGFUSE_PUBLIC_KEY`,
  `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` from the shell. Defaulting
  the bind to `127.0.0.1` keeps a self-hoster's Gemini quota off the
  network; `BIND_ADDRESS=0.0.0.0` opens it to the LAN (documented).
- Secrets come from Doppler at start-up:
  `doppler run --project tfl --config prd -- docker compose up -d`.
  The owner creates the `prd` config with `GEMINI_API_KEY` (and the
  Langfuse keys if wanted). Nothing secret is baked into the image.
  Non-Doppler self-hosters export the same variables or use a
  git-ignored `.env` file that compose reads.
- The image builds natively on arm64 (the Pi) and amd64 (CI).

### 3. Dependencies

- Update every dependency to its latest version in one pass, majors
  included. For each major, read the changelog/migration notes and adapt
  code. If a major cannot be adopted cleanly, stop and report rather than
  hold it back silently.
- Remove dependencies the code no longer uses (confirm by search before
  removing; `cors`/`@types/cors` at minimum).
- React lockstep:
  - `react` and `react-dom` pinned to the same exact version (no `^`).
  - Dependabot group `react` covering `react`, `react-dom`,
    `@types/react`, `@types/react-dom`, so they always move together.
  - `scripts/check-react-versions.mjs` compares the installed `react` and
    `react-dom` versions and exits non-zero on mismatch. Runs in CI. This
    is what stops a single-package Snyk PR.
- After the branch merges, the owner closes #37 and #40 as superseded.

### 4. CI

`ci.yml`, one job on every PR and push to `main`:

1. `pnpm install --frozen-lockfile`
2. format check, lint, type-check (as today)
3. `node scripts/check-react-versions.mjs`
4. `pnpm test`
5. `pnpm build`

`smoke` job (needs `ci`):

1. `docker build` the image.
2. Run it with a dummy `GEMINI_API_KEY`; wait for `/health`.
3. `pnpm test:e2e` (Playwright, Chromium only):
   - Load `/`; assert the main heading is visible and there are zero
     console errors and zero uncaught page errors.
   - Upload `sample/Amex - 2003 - October 2025 (Journeys).pdf` with
     `/api/gemini/generateContent` intercepted by Playwright and answered
     with a fixed, valid extraction response; assert the expense report
     renders. This exercises pdf.js and the app's parsing without
     calling Gemini.
   - Same flow with `tests/e2e/fixtures/statement.png`, a PNG made once
     from page 1 of the sample PDF and committed. This exercises
     tesseract.js OCR. The OCR language data must load without
     network access beyond what CI allows; if tesseract fetches it from
     a CDN at runtime, the plan pins or vendors it.

Single source of truth for versions: CI and the Snyk workflow use
`pnpm/action-setup` without a `version` input (reads `packageManager`)
and `actions/setup-node` with `node-version-file: .node-version`. The
Snyk action is pinned to a release tag, not `@master`.

New dev dependency: `@playwright/test`.

### 5. Auto-merge

`.github/workflows/auto-merge.yml`, on `pull_request_target` for PRs
opened by `dependabot[bot]` or `snyk-bot`:

- Dependabot: `dependabot/fetch-metadata` gives the update type.
- Snyk: parse the `from X to Y` versions in the PR title.
- Patch or minor: `gh pr merge --auto --squash`. GitHub merges only once
  every required check passes.
- Major, or a version that cannot be parsed: add label
  `needs-review`, no auto-merge.
- The workflow never checks out or runs PR code.

Owner actions (outward-facing, not done by agents):

- Branch protection on `main`: require `ci` and `smoke`; enable
  "Allow auto-merge" in repo settings. The plan gives the exact `gh api`
  command.
- Snyk web UI: keep automatic upgrade PRs on; no setting change is
  required for the gate, since CI catches bad bumps.

### 6. Docs and cleanup

- README: replace the run section with three paths: `pnpm dev`,
  `docker compose` with Doppler, `docker compose` with a `.env` file.
  Document `HOST_PORT`, `BIND_ADDRESS`, required and optional env vars.
- Delete the `.playwright-mcp/` folder left on 2026-11-01 (local, untracked).

## Out of scope

UI changes, reverse proxy / TLS / domain configuration (Traefik, Caddy),
app-level login, Vercel, calling the real Gemini API in CI.

## Risks

- A major bump (for example pdf.js or tesseract.js) may need code
  changes beyond the smoke test's coverage. The smoke test covers the
  PDF and image paths with Gemini mocked; CSV upload and the calendar
  selection logic rely on the existing vitest tests.
- Auto-merge trusts the smoke test. A patch release that breaks a path
  the test does not cover would merge. Accepted for a private tool;
  revisit before going public.
- `gemini-3.5-flash-lite` extraction quality is not covered by CI; the
  owner confirms with the sample statement after deploy.
