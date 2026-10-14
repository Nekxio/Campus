# Plan 004: Run fictional browser workflows reproducibly without production auth seams

> This plan supplies the browser foundation required before plans 005 and 006.
> First run `git diff --stat e0adfff..HEAD -- package.json pnpm-lock.yaml .github/workflows/ci.yml .gitignore scripts/tsconfig.json README.md` and compare `plans/baseline.json`.
> Verify untracked source against the recorded hashes and excerpts too.

## Status

- Priority: P1 for interactive changes
- Effort: M–L; fixture isolation and real virtual-passkey setup are the main cost
- Risk: LOW if the production application stays untouched
- Depends on: none; execute after 001–003 in the agreed sequence
- Category: tests
- Planned at: commit `e0adfff`, 2026-10-13, including uncommitted source
- Audit finding: 6 (renumbered here to precede interactive fixes)

Execution reconciliation, 2026-10-14: the partial tooling/dependency changes in the isolated
checkout are expected changes from this plan, not unexplained drift. Production source is
unchanged during 004. Fixture isolation passed both viewports, and desktop real authentication
and public-data privacy passed. Two business-gate attempts stopped at selectors/client readiness.
Resume with the diagnostic gate below; do not rerun the entire suite or change app source blindly.

## Why this matters

The 231 existing tests cover domain logic, local database services, authentication and HTTP
boundaries. Browser validation exists as historical manual evidence, but CI cannot replay editor
draft retention or downloaded PDF content. Add one secret-free command running the real interface
against disposable fictional storage. Test-only database substitution must never become a
production authentication bypass.

## Current state

`vitest.config.ts:5` runs Node tests and excludes Svelte component tests:

```ts
environment: 'node',
expect: { requireAssertions: true },
include: ['src/**/*.{test,spec}.{js,ts}'],
exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
```

`.github/workflows/ci.yml` installs frozen dependencies, runs lint/types/tests/build, then uses
fetch/curl on a credentials-free Workers preview. Keep that production-source smoke check.
There is no Playwright Test dependency/config/script. The separately managed MCP is pinned to
`@playwright/mcp@0.0.83`; do not change it or add another server. Its prerelease browser dependency
is unrelated to the stable test-runner choice below.

`src/lib/server/auth/runtime.ts` constructs the real Better Auth instance per operation and closes
the libSQL client in `finally`. `src/lib/server/teaching/database.ts` calls `requireTeacher` before
database access. `src/lib/server/db/index.ts` intentionally permits only configured remote Turso
URLs for production. Existing test fixtures are fictional and use this migrated pattern:

```ts
client = createClient({ url: ':memory:' });
await migrate(createDatabase(client), { migrationsFolder: './drizzle' });
```

`src/lib/server/auth/auth.test.ts` demonstrates `issueInvitation`, the passkey registration
endpoints and session cookies. Browser tests must actually activate/sign in; do not inject
`event.locals`, forged cookies or mocked successful authentication responses.

Keep luma tokens and approved `rubric-table`, `grid-split`, `correction-bottom-summary`,
`publish-sections` and `student-tabs`. No UI redesign is part of this plan. The product has one
teacher account audience; students read public selected material and never get accounts.

## Commands you will need

| Purpose                                         | Command                                                     | Expected                                            |
| ----------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| Add exact test-only dependencies, executor only | `pnpm add -D -E @playwright/test@1.64.0 pdfjs-dist@6.4.299` | Manifest/lock updated by pnpm only                  |
| Install local Chromium, executor only           | `pnpm exec playwright install chromium`                     | Browser available                                   |
| CI browser install                              | `pnpm exec playwright install --with-deps chromium`         | Ubuntu browser dependencies available               |
| New browser suite                               | `pnpm test:browser`                                         | All fictional workflows pass; no skipped core cases |
| New browser types                               | `pnpm check:browser`                                        | Zero errors                                         |
| Existing gates                                  | `pnpm lint`, `pnpm check`, `pnpm test`, `pnpm build`        | Exit 0                                              |

Both dependency versions were queried from their package metadata when planning and support Node 26. Pin them exactly. Consult [official Playwright installation](https://playwright.dev/docs/intro)
and [CDP sessions](https://playwright.dev/docs/api/class-cdpsession); use installed types if docs
differ. Do not use an initializer that replaces existing configs.

## Scope

In scope:

- `package.json`, `pnpm-lock.yaml` (installer-managed dependency/script changes)
- `playwright.config.ts`, `tests/browser/tsconfig.json` (new)
- `tests/browser/{fixtures.ts,auth.spec.ts,drafts.spec.ts,grading.spec.ts,publication.spec.ts,pdf.spec.ts}` (new)
- `tests/browser/support/` (fixture copy, virtual authenticator and PDF assertions only)
- `scripts/browser-fixture.ts` (new), `scripts/tsconfig.json` (include new tooling if necessary)
- `.github/workflows/ci.yml`, `.gitignore`, `README.md`
- Ignored generated artifacts below `.svelte-kit/browser-fixture/` and `.playwright-mcp/`
- This plan's index row

Out of scope: production files below `src/`, Vite production config, Wrangler config, existing
fixtures/migrations, auth operators, real records, provider accounts, source skills and MCP config.
Never widen `COURSELY_MODULE_ROOTS`. Do not add a production test flag or fixture route.

## Git workflow

Keep pending work intact. Use `but status` and GitButler for mutations only when requested; no
automatic commit/push/merge. An `execute` dispatch uses an isolated checkout. pnpm owns the
lockfile; do not hand-edit it. Tabs/single quotes/no trailing commas/100 columns apply to code.

## Steps

### Diagnostic gate after the stopped business run

Before changing readiness helpers again, collect the missing evidence from one owned desktop
fixture and the existing draft scenario: sanitized client `pageerror` messages/error codes and
failed script/module requests (origin/path/status only, no query, fragment, headers or bodies).
Record numeric copy/migration/seed/server-ready timings from the new IPC metadata. Never print
invitations, cookies, passkey material or auth secrets; redact opaque token strings from messages.
Keep traces/videos/storage state disabled. A diagnostic failure is evidence, not a passing core
scenario. Report it to the reviewer before another functional retry.

Distinguish a fixture/optimizer/import problem from a genuine application runtime error. Read the
matching installed Kit/Svelte/Superforms code and current source. Do not add arbitrary sleeps,
inflate timeouts, force a tab with DOM evaluation, inject locals or change successful responses.
The responsive editor uses desktop tabs and a mobile native select; readiness must exercise the
actual control for each viewport. Once evidence identifies an in-scope harness fix, document it
and run the affected desktop scenario first. If production changes are required, STOP and provide
the exact error, source attribution and proposed scope for review.

Verify: numeric timings and a sanitized diagnostic result are available; owned scratch paths are
removed after the probe. Only then resume the original numbered steps and all final gates.

### Step 1: Create the runner and test type boundary

Add the exact dev dependencies and Chromium. Configure two Chromium projects: desktop 1440×900
and mobile 390×844 with touch emulation. Start with one worker to isolate fixture storage. Add
`test:browser` as `playwright test` and `check:browser` as `tsc --noEmit -p tests/browser/tsconfig.json`.
Use test-scoped fixtures in `tests/browser/fixtures.ts` to spawn the local fixture script over
private IPC and own its process, connection metadata and cleanup. Each scenario gets fresh
storage and authenticates in a fresh browser context; never reuse a running developer preview.
Configure reports, downloads and screenshots inside `.playwright-mcp/browser-tests/`, already
ignored. Disable traces/videos/storageState persistence for activation/session tests; they can
contain credentials. Assertions and diagnostics must not print tokens or cookies.

Verify: `pnpm exec playwright --version` reports 1.64.0, `pnpm exec playwright test --list`
lists both projects, and `pnpm check:browser` exits 0. `pnpm test` still uses the original Vitest suite.

### Step 2: Build a disposable local validation copy

`scripts/browser-fixture.ts` must copy an explicit source/config/static/migration allowlist into
a fresh directory under `.svelte-kit/browser-fixture/`. Link the installed node_modules; do not
copy `.env`, `.dev.vars`, `.git`, `.agents`, `.codex`, `.impeccable`, `data/` or user documents.
Do not load any environment file. Refuse arbitrary external base URLs; bind only 127.0.0.1 on
a selected available port and refuse any pre-existing server. Use `http://localhost:<port>` as
the owned browser/auth origin: [WebAuthn requires a domain host for RP IDs](https://www.w3.org/TR/webauthn-3/#sctn-createCredential),
and the unchanged auth configuration derives RP ID from the origin hostname. This loopback test
choice never changes the production origin. If the runner uses Playwright
webServer configuration, set `reuseExistingServer: false`; never use it to persist credentials.

Use a new file-backed native libSQL database with mode 0600, versioned local migrations and
`seedPublicationFixtures` (which composes grading fixtures). Generate a random auth secret
per run and send it only via the child environment/IPC; never print it. Override only generated
copy `src/lib/server/db/index.ts` to use the native local driver and the exact freshly allocated
fixture file. Original production `index.ts` must remain byte-identical. All guards, hooks,
createAuth, routes, service logic and Svelte components are copied unchanged.

The copy's DB adapter must reject any URL except its allocated file, provide the same createDatabase
interface and retain closing semantics. Set its ORIGIN to the loopback server. Start the copied
app with its existing Vite development command; this Node-backed fixture is not a Workers runtime
acceptance claim. Record a manifest of copied-file hashes and the one allowed generated adapter
override. On shutdown/failure, close clients/processes and remove only owned scratch paths.

Lifecycle review refinement, 2026-10-14: the parent fixture process must allow more cleanup time
than the child's server-termination budget plus directory removal. Equal 5-second budgets can
kill the child before it sends SIGKILL to a stalled owned server. Test this path by suspending
only the fixture's own Vite process with SIGSTOP, requesting normal fixture shutdown, and
asserting both process disappearance and directory deletion. Any PID metadata remains private
test IPC; never signal an unrelated process. This is test-only lifecycle scope, not a production
runtime change or an increased UI-readiness timeout.

Provide test-runner support for seeding/mutating that same fictional DB through existing services,
not through new HTTP control endpoints. Invitation issuance may use `issueInvitation` on the
new fixture DB directly; do not run the credential-loading CLI. Return invitations over private
test IPC/in-memory fixtures, not logs or tracked manifests.

Verify: `pnpm test:browser --grep 'fixture isolation'` checks the adapter override manifest,
new/owned storage, rejected external URLs, untouched original source hashes and cleanup after
failure. An anonymous request to private pages must still redirect; public readers must work
without teacher identity. Stop if another production-source override is needed.

### Step 3: Exercise actual browser authentication and saved drafts

Use Chromium CDP `WebAuthn.enable`/`addVirtualAuthenticator` with CTAP2, internal transport,
resident keys, user verification and automatic presence. Activate a fresh fictional invitation
through `/activation#…`, verify the fragment is removed, and reach teacher home. No API response
for authentication may be mocked as successful. Reuse this setup per browser context.

Add passing characterization cases for module save/reload, correction blank vs zero, dirty
navigation cancelled/confirmed, HTTP 409 retaining text, and publication snapshot remaining stable
during private edits. Use roles/labels and web-first assertions, no fixed sleeps. The known lost-
creation-response defect is implemented/tested in plan 005; do not fix it here or hide it with a
mocked success. Similarly, hourly session renewal belongs to plan 006.

Verify: `pnpm test:browser --grep 'authentication|draft|correction|publication'` passes both
viewport projects. Anonymous API writes remain refused before payload decoding. Assert no student
name, point or private comment marker in public HTML/data responses.

### Step 4: Assert downloaded full-class PDF content and add CI

Complete twelve fictional students through grading services. Filter the visible grid to one,
download using the real browser button, and parse the downloaded PDF with the test-only
`pdfjs-dist` Node entry. Assert all twelve names, defined result titles, accents and no private
comment/submission markers. Also verify unresolved required results disable/block export.
Artifacts must contain fictional records only and remain ignored.

Add browser dependency installation, browser types and the suite to the existing CI job without
removing its production Workers smoke test. Do not upload traces, storage state, invitations,
session cookies or DB copies. If the 15-minute budget is exceeded, report measured durations
before changing CI topology; do not skip core scenarios to fit.

Measured budget reconciliation, 2026-10-14: the first complete local macOS suite passed all
16 cases in 899,642.124 ms (14 min 59.642 s), without skipped/flaky cases. It exhausts the old
15-minute job before dependency/browser installation and other gates. Increase only the existing
quality job timeout to 30 minutes, retaining its topology, permissions and Workers smoke steps.
This is a local measurement and budget allowance, not evidence that GitHub Actions ran on Ubuntu.

Verify: `pnpm test:browser`, `pnpm check:browser`, existing lint/types/tests/build, and
`git check-ignore .playwright-mcp/browser-tests/result.pdf .svelte-kit/browser-fixture/example.db`
all succeed. Run `pnpm test:browser` once more only to establish independent clean-state replay;
no existing preview/database may be reused.

Execution review arrangement, 2026-10-14: the executor runs the first complete suite; the reviewer
runs the second complete suite independently in the isolated checkout after reviewing the full
diff. Both runs use new test-scoped fixtures. This satisfies the two-run gate without a redundant
third complete suite; the executor must report the reviewer replay as pending until it finishes.

## Test plan

At least seven independent cases: fixture isolation, actual passkey activation/sign-in,
anonymous/private boundaries, saved module draft, dirty navigation, correction conflict retention,
publication privacy/stability and full-class PDF content (combine only where assertions remain
clear). Keep desktop/mobile behavior and keyboard access in the same scenarios. This tests layout
emulation, not a physical phone or screen reader. Production Workers HTTP checks remain separate.

## Privacy and French/EU requirements

Use synthetic teacher/student identities and external `example.test` links; deny unexpected
outbound requests while allowing same-origin app resources. No real account, student data or cloud
credentials. Test artifacts need minimization, access restriction and deletion just like any data
store; do not record auth secrets even though test-only. RGPD Articles 25/32 inform the boundaries;
see [CNIL security obligations](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4).
The operator confirmed only his individual account is intended now; fictional rosters exercise
the future student-data features without activating them for real use.

## Done criteria

- [x] Both viewport projects pass from fresh scratch storage, twice independently.
- [x] Real passkey/session checks run without forged locals or successful-auth stubs.
- [x] Only the generated copy's DB adapter differs from copied application source.
- [x] Full-roster PDF text and public-data privacy assertions pass.
- [x] Browser types and existing verification gates pass; CI retains Workers smoke coverage.
- [x] No artifacts/credentials/DB files are tracked; only scoped files changed.
- [x] README documents one-command execution and physical-device/VoiceOver limitations.

## STOP conditions

Stop if isolation requires changing production auth/DB guards, the copied runtime loads private
files, a test contacts a non-loopback data service, package versions are unavailable/incompatible,
virtual user verification cannot be exercised, or two gate attempts fail. Scope or production
architecture changes require a revised plan. Do not claim HTTPS cloud acceptance from loopback.

## Maintenance notes

The fixture copy must be rebuilt from live source each run; hash manifest tests catch stale copied
routes/components. Keep the single adapter override small and reviewed. Plans 005 and 006 extend
this harness; production secrets and real records must never be added to CI.
