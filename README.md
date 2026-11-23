# Campus

Campus is the application name. Configure development and production databases independently,
with dedicated credentials for each deployment. Database creation, tokens, migrations and deployment
remain explicit operator actions. `.env.example` documents the configuration without changing
existing private env files. A change of production hostname requires new passkey activation.

Persisted `coursely` cookie/key namespaces, OAuth claims, `.coursely.json` bindings and historical
migrations retain their identifiers for compatibility. Existing `COURSELY_PRODUCTION_*` CI variables
also remain unchanged. Delivery guards and GitHub API calls target `Nekxio/Campus`; set
`COURSELY_PRODUCTION_ORIGIN` to the configured Worker origin before enabling its deployment. The local MCP
now starts through `scripts/campus-mcp.ts` with `CAMPUS_MODULE_ROOTS` and `CAMPUS_AGENT_CONFIG_FILE`.
Review the full migration chain and selected database journal before the separate operator action
`pnpm db:migrate` with its dedicated configuration. The enabled production CI applies pending migrations
through the guarded backup procedure below. Never run migrations as diagnostic probes.

Campus is a SvelteKit 3 / Svelte 5 / TypeScript application with shadcn-svelte, Tailwind CSS 4,
Cloudflare Workers, Turso/Drizzle and invitation-only teacher passkeys. It provides annual classes,
module preparation, native quizzes, grading, correction proposals, publication and final PDF exports.

[PRODUCT.md](PRODUCT.md) defines the approved behavior, [GLOSSARY.md](GLOSSARY.md) the domain terms,
and [DESIGN.md](DESIGN.md) the visual system. This README covers setup, workflows and validation;
[MCP-COVERAGE.md](MCP-COVERAGE.md) specifies the remote agent interface. [AGENTS.md](AGENTS.md)
contains implementation instructions. Local plans, generated reports and tool state are not sources
of truth for the versioned project.

## Getting Started

Use Node **26.13.0** (`.node-version`) and pnpm **12.11.2** (`packageManager`).
Node 26.13.0 includes the Undici fix needed to cancel oversized multipart bodies without unhandled stream errors.
Dependency versions are resolved in `pnpm-lock.yaml`.

The [CI workflow](.github/workflows/ci.yml) deploys validated release merges into `main` when the
production flag is enabled, and validated `develop`/release pushes to the separate shared preview.
Preserve the configured origin, rpID, existing passkeys and Better Auth
secret when updating an existing deployment. A new origin requires new passkey activation.
Local preparation never deploys or provisions remote services. Repository files do not establish
the current deployed SHA, remote migration journal or service health.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Without database credentials and authentication secrets, the sign-in page shows an unavailable
state and private pages remain inaccessible. A usable teacher workspace requires the dedicated
database migrations and a teacher passkey. Existing private local files are ignored by Git and
must not be committed. Local fixture previews are separate validation copies, not an authentication
bypass in this project.

### Production database migrations in CI

An enabled production release push verifies the exact applied migration prefix (timestamps and SQL
hashes) before deploying. If migrations are pending, CI reads a consistent database snapshot,
rehearses its restoration in memory, encrypts it with AES-256-GCM, and persists the encrypted SQL
backup as a GitHub Actions artifact for 30 days. Only after a successful upload does CI apply the
pending migrations. It then requires the complete journal and valid foreign keys, and rechecks the
current main commit before deploying. A current database is checked without reapplying migrations
or creating another backup. Divergent journals, missing configuration, backup failures and migration
failures block deployment. Preview migrations remain an explicit operator action.

Configure these repository settings before the next production release:

- Variable `CAMPUS_PRODUCTION_DATABASE_URL`: the independently verified production database URL,
  exactly matching the existing `TURSO_DATABASE_URL` secret. Infrastructure values stay in configuration.
- Secret `CAMPUS_PRODUCTION_BACKUP_KEY`: 32 random bytes encoded as 64 hexadecimal characters
  (generate with `openssl rand -hex 32`). Keep an independent recovery copy outside GitHub; retain
  previous keys until all backups encrypted with them have expired. Never print the key in CI.
- Existing production database credentials remain scoped to the database preparation and deployment
  steps, after the build, packaging checks and stale-commit guard. No additional package is required.

Review every migration for compatibility with the Worker still serving traffic during migration.
Use additive changes and staged transitions; destructive or incompatible changes require a separate
operator maintenance plan. Serialize manual production migrations with the production job. Do not
change published SQL files or their journal timestamps. This gate checks history and integrity;
it does not prove application compatibility. A failed deployment can leave the database migrated;
retry the same release after diagnosis, or use a compatible application rollback. No automatic
schema rollback or backup restoration runs against production.

For recovery, download the encrypted artifact from the specific deployment attempt before its
retention expires. On a trusted operator machine, set `CAMPUS_PRODUCTION_BACKUP_KEY` using the
matching recovery key, `CAMPUS_BACKUP_INPUT` to the downloaded `.enc` file, and
`CAMPUS_BACKUP_OUTPUT` to a new private SQL path under ignored `data/backups/`. Run:

```sh
pnpm exec tsx scripts/production-migrations.ts decrypt-backup
```

The command authenticates the encrypted file and creates the SQL file exclusively with mode 0600,
without printing its contents. Restore it only to a new isolated SQLite database, then check its
integrity, foreign keys, journal and application behavior before an explicitly authorized restore
or cutover. The backup covers the Turso application database; quiz Durable Object storage and
external files keep their separate recovery procedures. Writes after the snapshot are outside its
recovery point. Extend backup retention through an explicit operator policy if 30 days is insufficient.

### Dependency maintenance

Prefer recent stable releases behind the newest release, without major-version migrations.
Updated direct dependencies are pinned exactly; security fixes may require the newest patch in
an existing release line. The direct Miniflare prerelease matches Wrangler's runtime dependency;
there is no stable Miniflare 5 release yet. `pnpm-workspace.yaml` keeps vulnerable transitive
versions above their published security floors. Recheck these overrides when updating their parents.

Run `pnpm audit --prod` and `pnpm audit` when reviewing dependency changes; recorded results from
an earlier installation do not establish the current advisory status. Review compatibility before
forcing transitive major versions, and keep development-tool findings visible.

`patchedDependencies` applies the [upstream minimatch resource-limit fix](https://github.com/isaacs/minimatch/commit/77a0f5c4b80bdc641c3c930a1d9edf5ad2db57f8)
to both distributions of 10.2.6 without forcing version 11 on its consumers. Keep the patch with
the lockfile and run the dependency-patch regression tests after installation. Replace this
BlueOak-1.0.0 backport when compatible parent releases resolve to an upstream fixed version.
Version-based audits still report minimatch despite the local fix. They also still report
deepmerge's [rejected CVE-2026-93753](https://www.cve.org/CVERecord?id=CVE-2026-93753);
the rejection was verified on 2026-11-14. Its inspected use is trusted local Svelte configuration,
with no identified untrusted runtime path; the rejected record does not justify a local fork.
Neither advisory is suppressed in package-manager settings.

## Development and Validation

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm preview
```

`pnpm preview` serves the existing Worker build locally; it is separate from the deployed preview
environment. Run `pnpm build` again after source changes. Production and shared-preview deployment
remain in CI, behind their commit, environment and release checks.

| Need                                                       | Command                                               |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| Watch application types after generating Worker bindings   | `pnpm check:watch`                                    |
| Watch unit tests / run one file once                       | `pnpm test:unit` / `pnpm test:unit --run <file>`      |
| Validate the Worker runtime locally                        | `pnpm test:worker`                                    |
| Check browser test types / run fictional browser scenarios | `pnpm check:browser` / `pnpm test:browser`            |
| Inspect a built Worker package without uploading           | `pnpm worker:dry-run` in a copy without local secrets |

`pnpm check` also checks operator-script types; `check:watch` watches application types only.
Keep manual database migration, account/key management, release preparation and deployment-target
preparation as explicit operator commands. They are not part of installation, tests or build.
The production deployment job is the only automated cloud-migration path.

`pnpm lint` checks formatting and then ESLint; `pnpm format` writes formatting changes.
Both CLI checks respect `.gitignore`. `.prettierignore` also lists local exclusions for editor
integrations and excludes generated Drizzle metadata and Worker types from formatting.
ESLint imports `.gitignore` and additionally excludes Worker-generated types. Application code,
operator scripts, examples and tests remain in scope.

`vite.config.ts` configures SvelteKit, Tailwind and the Cloudflare adapter. The separate
`vitest.config.ts` runs Node-based tests for domain validation, roster imports, Paris calendar
conversion, rubric replacement, grading calculations, correction forms and private teaching services,
local MCP imports and agent API-key access.
It also runs local migration, database-constraint and cryptographic WebAuthn integration tests
against isolated in-memory libSQL databases. Tests never load local environment files or contact Turso.

### Mutation testing

[StrykerJS](https://stryker-mutator.io/docs/stryker-js/introduction/) deliberately changes production
code and checks whether the existing tests fail. It measures fault detection, not the percentage
of useful tests. A surviving mutation needs review; it does not automatically mean a bug or a
useless test. Tests that kill the same mutation can still cover different requirements.
Runs can stop at the first failing test, so kill attribution is not a reliable list of redundant tests.

```sh
pnpm test:mutation
pnpm test:mutation --mutate src/lib/domain/grade-calculation.ts
pnpm test:mutation --incremental
pnpm test:mutation --incremental --force
```

`stryker.config.json` targets ten business modules: academic years, grade calculations, final
exports, grading selection, publication, quiz content and sessions, roster import, rubric points
and Paris calendar conversion. `vitest.mutation.config.ts` extends the existing Vitest configuration
with related tests from `domain`, `grading`, `teaching` and `quizzes`. To include related server
integration tests, change `vitest.configFile` in the Stryker configuration to `vitest.config.ts`
and run fresh; this extended run is substantially slower. Browser behavior, Svelte components,
Worker runtime tests and server modules outside this mutation list are not assessed by this score.
Override `--mutate` and, when needed, the Vitest include patterns to investigate another file; never
mutate test files or the isolation infrastructure. Two concurrent runners bound local resource use.

Keep test selection in Vitest: Stryker 10.1.1's `testFiles` option switches static mutants to runtime
activation, after static imports, and can therefore report unactivated mutations as survivors.

Test commands invoke the native Vitest, Playwright and Stryker CLIs. A shared Node preload,
`scripts/prepare-tests.ts`, filters inherited environment variables and creates a temporary home
before the runner starts. Worker processes inherit that environment without losing their own
runner configuration; normal process exit removes the temporary directories. Runner arguments,
watch mode and exit codes use the tools' native behavior. Use the package commands to retain this
preparation, rather than invoking an unprepared CLI directly.

`pnpm test:mutation` uses the same preparation.
Stryker copies only explicitly allowed sources and configuration into its sandbox, excluding local
environment files, private data and generated output. Its coordinator needs a local logging socket;
the Vitest test forks still preload `scripts/test-isolation.mjs` to block private file access and
unapproved network access. The two pinned development dependencies are Stryker's mutation engine
and its Vitest adapter; version 10.1.1 supports the fork pool used by the existing isolation.

The local reports are `reports/mutation/index.html` and `reports/mutation/mutation.json`.
Reports and `.stryker-tmp/` are ignored by version control and formatting. Runs are fresh by default.
Incremental mode reuses `reports/mutation/incremental.json`; use `--force` after dependency,
configuration, test-selection, fixture or unmutated-helper changes because these do not reliably
invalidate the cache. Use a fresh or forced run to measure test improvements: in Stryker 10.1.1,
new tests can leave static mutants' cached results unchanged when they have no per-test coverage.
A focused incremental run can retain older results outside its requested scope.
Old test definitions can remain in report metadata even with `--force`; the dry-run log gives the
number of tests actually executed.

Review `Survived` and `NoCoverage` against the business requirement before adding assertions.
Prefer boundary cases and observable outcomes over assertions about internal calls or incidental
wording. Inspect `RuntimeError` and `Timeout` separately: errors are excluded from the score and
timeouts count as detected mutations without an assertion failure. No mutation category is globally
excluded, and no blocking score threshold is set before the baseline has been reviewed. Mutation
testing remains an explicit local diagnostic, separate from the normal test command and CI.

Treat a claimed equivalent mutation as conditional on the validated input, callers and runtime.
Do not remove defensive guards based only on a survivor or a test outside the selected mutation
scope. Match results by file, full location, mutator and replacement; numeric mutant IDs are not
stable between campaigns. Removing a message, changing an error class or altering exported labels
can change a contract even when rejection still occurs.

The following simplifications require a new proof before changing production code: the `1e-8`
weight-tolerance boundary in grade calculation; optional assessment lookups in calculation/export;
calendar disambiguation values and error types; and quiz review errors versus incidental TypeErrors.
An idempotent stored result does not make repeated-removal commands valid. These are review limits,
not confirmed defects or permission to weaken validation. Do not infer current coverage gaps from
old mutation inventories; reproduce a distinguishing behavioral case with the current sources.

### Browser and type checks

Browser tests use the installed **Google Chrome Stable** through Playwright's `channel: 'chrome'`
for both the desktop and mobile-emulation projects. The Playwright package stays locked in
`pnpm-lock.yaml`; a separate bundled Chromium download is not required for this configuration.
Chrome must already be installed: the runner never installs it or silently selects another browser.
Each scenario logs and annotates the actual browser version, because system Chrome can auto-update.
Playwright uses a temporary isolated profile, never the operator's personal Chrome profile.
Run `pnpm check:browser`, then `pnpm test:browser --project=desktop --project=mobile`. The runner
creates an isolated environment and each scenario creates its own fictional source/database copy;
see [Fictional browser workflows](#fictional-browser-workflows). Mobile emulation does not replace
Safari or a physical-phone acceptance test.

This Playwright suite includes end-to-end workflows through the browser, application server and
fictional database, including authentication, grading, publication and PDF downloads. There is no
separate E2E runner. `pnpm test` runs the unit/local integration suite only; Worker and browser
checks have their own commands. Use `pnpm test:browser --list` to inspect discovered scenarios
without starting the application or browser.

Strict TypeScript mode is enabled. `checkJs` is disabled to prevent Wrangler-generated types
from importing and analyzing built JavaScript bundles in `.svelte-kit`. TypeScript checks the
application, and ESLint also checks JavaScript configuration files. `check` and `build`
automatically regenerate Workers types.

## Teacher Workspace

The selected “Prochaine intervention” home composition uses stored module summaries and the next
lesson. Its module search opens the actual draft editor. Narrow layouts use a module list and a
mobile navigation sheet. Notation opens the private grade grid.

`/enseignant/classes` selects a class from the current Paris academic year (September 1 boundary),
with its common roster beside associated modules. New web classes receive that year automatically.
Daily class choices never fall back to older or future cohorts; year selection belongs to annual
management and historical access. Create or edit a class; add, rename or remove a student; preview pasted names or a CSV
before importing; and attach an existing module. Duplicate imported names are reported and skipped.
The planning range of twelve students is not a product limit. Removing a student asks for explicit
confirmation and removes that student's associated records.

`/enseignant/modules/nouveau` creates a draft without requiring a class.
`/enseignant/modules/[moduleId]` edits the same reusable module through four sections: Informations,
Préparation, Liens étudiants and Classes et planning. Objectives, private preparation and references,
selected student HTTPS links and optional class lessons are saved together. Public module/project
instructions and ungraded exercises with freely accessible corrections are edited in Liens étudiants.
One active module belongs to one class; attaching it elsewhere creates an independent pedagogical copy
without students, grades, lessons or deadlines. The local source path
is a textual reference; the website does not read the Mac's files. Paris lesson times are stored
in UTC, and invalid or ambiguous daylight-saving times are reported instead of silently adjusted.

Forms retain a draft on failed saves. Optimistic revisions prevent an older window from replacing
a newer edit, and reloading a conflicting module asks before discarding local changes. Retried
module creation uses the same request key to avoid duplicate drafts. Saving does not publish a
student page or modify Drive sharing.

The shell retains the dashboard-01 arrangement and luma theme: an inset page, a header toggle and
an 18rem offcanvas sidebar. The authenticated name and initials appear beside the account menu,
which supports sign-out. Its light/dark/system selector uses `mode-watcher` and the shadcn-svelte
Toggle Group; system mode follows operating-system changes.

Shared components use the `#lib` aliases defined in `components.json`, with explicit `.js`
extensions and `index.js` for component barrels. See `PRODUCT.md` for approved scope and
`DESIGN.md` for the implemented visual system.

### Private Grading

`/enseignant/modules/[moduleId]/bareme` edits evaluations, groups, scoring lines, descriptions,
integer maxima and result rules. It also edits class-context deadlines and submission instructions
in Paris local time. [PRODUCT.md](PRODUCT.md#capabilities-and-constraints) defines scoring,
absence, delay and retained-history rules; [GLOSSARY.md](GLOSSARY.md) defines their terms.

`/enseignant/notation` selects a module and annual class; `module` and `contexte` query parameters
retain this context. Search and completion filters narrow the roster. Open
`/enseignant/notation/[contextId]/[studentId]` for criterion points, submission details and direct
previous/next student navigation. Save corrections explicitly; save or copy the private semester
comment separately. Dirty navigation asks before discarding edits; save errors and HTTP 409 retain
the draft. [DESIGN.md](DESIGN.md#approved-compositions) defines the grading layouts. Keep concise
summary issue counts and complete, deduplicated diagnostics in the work body; Formsnap associates
each input with its rubric description, maximum/range guidance and errors.

Teacher-only PATCH endpoints update the module rubric, one student's assessment correction or the
separate semester comment. They require the same origin and strict payloads, scoped class membership
and assessment identities, and transaction-backed revision checks for rubrics, contexts, corrections
and comments. [Final PDF export](#final-pdf-export) uses saved, revalidated results.

### Module Publication and Student View

Open **Publication** from a saved module to review its student-facing sections for one class/year.
The private review and public page share the snapshot-content renderer; their layouts follow
[DESIGN.md](DESIGN.md#approved-compositions). Live quiz-room status is separate from the reviewed
snapshot. Document labels and actions remain distinct; a PDF badge requires evidence in the selected
URL. Formsnap/Superforms/Zod handle context selection and explicit publish/unpublish decisions.

The previous snapshot stays public during draft edits. Module/context/class/publication revisions
prevent an older review from publishing unseen changes, and identical retries have transactional
receipts. HTTP 409 retains the reviewed preview until explicit refresh. Public
`/modules/[contextId]` and `/classes/[classId]` pages expose only validated published content,
without private preparation or auth state. Pages and errors are uncached and request no indexing.
Legacy snapshots require review and republication; they never expose a draft as fallback.
[PRODUCT.md](PRODUCT.md#current-approved-scope) defines public content, annual link continuity and
external-file boundaries.

### Final PDF export

Use the export controls below the module/class selectors and above filters. The complete-class and
individual document scopes are defined in [PRODUCT.md](PRODUCT.md#current-approved-scope).

Private reads authenticate first. Saved results are transactionally revalidated against the exact
module, class, year and permitted document fields. Missing, incomplete or invalid required results
block export. Browser PDF rendering reuses the calculation rules, one-decimal formatting, bundled
fonts and lazy loading; no rendering service or server-side PDF storage is used.

### Annual lifecycle

Select the year explicitly. Archived years retain read-only history and PDF access and can be
reopened. Annual closure reviews every module's continue/pause decision, requires the exact typed
year and retained-PDF confirmation, and uses a reviewed snapshot token with exact retry receipts.
[PRODUCT.md](PRODUCT.md#current-approved-scope) defines the deletion scope, durable content and
publication rules. Closure remains manual, without a retention-date prerequisite.

### Remote teaching MCP

The OAuth endpoint `/mcp` (`campus-app`) exposes 38 teaching tools. See
[the complete operation inventory and MCP comparison](MCP-COVERAGE.md) for HTTP methods, page
reads, form actions, permissions and verification limits. Account management is excluded.
The grading, publication, annual lifecycle, calendar, roster update/deletion and quiz review
permissions require explicit consent; existing connections retain their original rights.
Quiz rooms remain under manual teacher control in the interface and are excluded from MCP.
Draft imports never publish. Explicit teacher-delegated decisions
reuse the application's checked services, revisions, confirmations and retry receipts.

### Local Module MCP

The local stdio server provides six module tools: `inspect_module_folder`, `get_import_context`,
`bind_module_folder`, `create_module_draft`, legacy `update_module_draft` and targeted `patch_module_draft`. It writes private drafts
through the same transaction-backed services as the teacher editor. These six module tools have no correction, roster, publication or Drive operations. No new page
is added; imported modules are reviewed in the existing editor.

Configure the local MCP in your agent host with `pnpm mcp`, `CAMPUS_MODULE_ROOTS` and
`CAMPUS_AGENT_CONFIG_FILE`. For a fictional example, copy both
[`framing.md`](examples/mcp-module/framing.md) and
[`coursely-import.example.json`](examples/mcp-module/coursely-import.example.json) from
`examples/mcp-module/` into ignored `data/mcp-demo/`, then select that exact local folder.
Do not overwrite an existing working folder or its `.coursely.json` binding; use a separate local
folder if needed. Bindings, host configuration and private connection files remain local and
unversioned. Adding a real module folder requires selecting its precise path, never all teaching folders.

The operator-only `pnpm agent:key` command issues a teacher-bound API key with read/create/update/
rubric permissions, a default 30-day expiration (1–90 days) and a 60-request-per-minute quota.
Its private connection file is ignored, created with mode 0600, and never pasted into chat,
logs, `.coursely.json` or the tracked MCP configuration. The MCP reads neither `.env` nor Turso
credentials; it sends its key only to the configured HTTPS origin (HTTP loopback for local tests),
with redirects disabled. Keys cannot become browser sessions. Public API-key management endpoints
are blocked; revocation affects the selected key without removing teacher passkeys or sessions.

Creation uses the strict version-1 payload; preferred updates use version-2 targeted patches.
Omitted fields and array members stay unchanged, and removals are explicit. Legacy complete-field
updates require all scalar fields rather than silently applying creation defaults.
The creation payload groups module metadata, selected links, class calendars and an optional
rubric in one atomic transaction. `.coursely.json` stores stable IDs and the retry key before an
HTTP write, so a lost response can be retried without a duplicate. Updates require fresh module
and context revisions; a different stale write returns HTTP 409. Rubric replacement requires an
explicit flag and its own scope, preserves raw points and never changes the published snapshot.
The import context contains module/class metadata and rubrics, not student names, scores,
submissions, proposals or comments. See `POST /api/agent/modules`,
`PATCH /api/agent/modules/[moduleId]` and `GET /api/agent/context`.

`drizzle/0003_premium_tomas.sql` adds hashed API keys and import receipts. Authenticated stdio tools
require an operator-issued key; verify the selected database's migration journal before activation.

### Correction Proposals

Two additional MCP tools, `get_correction_context` and `propose_correction`, prepare private
criterion-point proposals for the exact module linked to an authorized local folder. New keys opt
into the correction scope explicitly; existing module-import keys receive no extra rights.
The read response contains only the chosen annual class roster and, when selected, one student’s
corrections and independent comment revision. A proposal stores integer points or explicit nulls,
current module/context/correction baselines and an optional semester comment with its own baseline.
Its stable proposal/request IDs recover an identical retry without duplicating or applying scores.
No student data is written into the local folder binding.

`/enseignant/propositions` follows the approved `proposal-inline-comparison` design. Open it from
the grade grid or the returned proposal link. Compare Enregistré / Proposé / Retenu, adjust integer
criterion points, inspect the live grading impact, then explicitly accept or refuse. Omitted proposal
lines keep their current recorded points; a proposed null stays missing. Points and the semester
comment have separate decisions and Formsnap/Superforms forms. Accepting points preserves the
current submission, delay decision and other assessments. Absence disables point inputs; retaining
points requires À évaluer or Noté. A changed rubric, class context, correction or comment blocks the
affected acceptance. Refresh keeps drafts, flags detached criteria and does not make a stale proposal
fresh; request a new proposal with current baselines. Browser decisions require a teacher session,
same-origin checks and strict server validation. Local API keys cannot accept or refuse proposals.
Remote OAuth clients can decide only with explicitly granted `grades:read` and `grades:write` rights,
through the same checked services and revision contracts.

Refusal does not change recorded scores; a pending proposed comment is kept, while an already
explicitly accepted comment remains recorded. Replayed decisions return the original receipt and
never reapply points after a later manual correction. Proposal payloads and their ID/hash-only
decision ledger are removed with their annual student/class data. Reusable module material survives.
`drizzle/0004_lyrical_skullbuster.sql` retains old version-1 proposals for consultation/refusal;
they must be regenerated before acceptance.

### Formsnap, Superforms and Zod

Teaching mutation forms use the project's shadcn-svelte Form components backed by Formsnap 2,
Superforms 3 and Zod 4. `Form.Field`, `Form.Control`, `Form.Label`, `Form.Description` and
`Form.FieldErrors` associate controls with their labels, help and validation errors. Client
validation uses `zod4Client`; strict server Zod contracts remain authoritative.

Teacher browser forms use named SvelteKit form actions through Superforms enhancement. The
existing JSON APIs remain available and call the same services. Each form has one typed store;
semester comments remain independent from corrections. The shared transport preserves captured
commands, revisions, retry identities, conflict drafts and edits made while a save is pending.
Structured commands use Superforms JSON serialization inside multipart form data; server actions
validate strictly and authenticate before parsing. Calendar URLs are removed from returned forms.

Profile editing, OAuth consent and application revocation also work without JavaScript for an
existing teacher session. They use canonical native fields and multipart POSTs. The origin boundary
accepts opaque Chrome navigation origins only on those three pages with complete same-origin
navigation metadata. Other editor workflows still require JavaScript. Live quiz controls, student
entry and answers, WebAuthn, sign-out and external protocol endpoints retain their existing transports.
Typed proxies continue to handle nested resources, lessons, rubric lines and scores.

Native OAuth token, revocation and introspection forms require exact endpoint paths, URL-encoded
POSTs and no `Origin`, `Cookie`, `Sec-Fetch-Site` or `Sec-Fetch-Dest` header, including empty values.
An absent `Sec-Fetch-Mode` or the lone `cors` value added by Node Fetch is accepted. Browser form
and fetch requests keep their origin/context checks; PKCE, resource and consent validation remain
the provider's responsibility.

Student quiz entry requires a secure context (HTTPS or loopback development) with Web Locks.
The browser serializes admission across tabs, acknowledges a `PUT` that prepares the room-scoped
HttpOnly cookie, then sends the `POST` that binds the participant. Lost claim responses can retry
with the same credential, including after the quiz starts. Preparing a cookie alone never claims
a roster entry: the name stays editable until the first durable claim. Correcting a prepared name
keeps the cookie unchanged; reconnects resolve its actual student binding from the Durable Object.
One credential cannot claim a second student. Browsers without Web Locks show an error before
any admission request.

Before starting a quiz, match each claimed roster name to the student present in the lobby;
participant counts alone do not establish identity. Resolve a wrong claim while lobby removal is
still available. After start, the questions may already have been displayed even when no answer
was saved. Interrupting a participant records a stopped attempt, not an absence eligible for an
automatic retake. Preserve the room and cohort, handle the incident and grading explicitly, and
do not promise a reset or automatic retake for the affected student.

Quiz closure transfers each student's grade through a separate internal `QuizRoom` RPC, keeping
external database requests below the Workers Free per-invocation budget. Each transfer rechecks
the current teacher session, room ownership, closed durable result and frozen SQL baseline before
using the existing transactional grade service and retry receipt. The teacher HTTP command waits
for the complete transfer and retains explicit per-student conflicts. Local development runs the
same guarded transfer in Node; the development quiz runtime receives no database credentials.

Superforms 3.1.0 supports SvelteKit 3 directly, using request-local `$app/state`; Formsnap 2.1.0
supports Superforms 3. The former `$app/stores` compatibility bridge and Vite alias are removed.
Node unit tests inline the Superforms server entry and replace only its server-only `$app/server`
marker with an empty module. Application code continues to use the real framework APIs.
Other dependency peer diagnostics remain visible.

UI variant recipes use `tailwind-variants/lite`; `cn` owns Tailwind conflict resolution at rendering
boundaries. Plain Svelte class arrays remain suitable where conflict resolution is unnecessary.
French date labels use cached native `Intl.DateTimeFormat` instances; Paris calendar conversions
and daylight-saving validation remain in `@internationalized/date`.

## Continuous Integration

The [workflow](.github/workflows/ci.yml) checks every branch push (except reserved
`automation/**` refs) and every pull request. Standard checks use the frozen lockfile and run
formatting, lint, application/operator/browser-test types, unit tests and local integrations.
PRs into `develop` or `main`, release branches and pushes to `develop`/`main` also run Worker
tests, the Cloudflare build, a credentials-free bundle dry run and local HTTP privacy/CSRF probes.
Browser execution stays local; mutation testing remains an explicit diagnostic.

Node comes from `.node-version`, pnpm from `packageManager`, and Actions are pinned by SHA.
Superseded quality runs may stop. Deployments use separate serialized queues per environment,
never cancel an active upload and skip a commit when its source branch has advanced.
Quality checks and builds receive no deployment secrets. Secrets are injected only for the
final upload, using private ephemeral files. Neither tests nor deployments migrate SQL databases.

### Local Git hooks

Campus does not run quality checks before commit; GitButler's own guards remain intact.
The legacy `.githooks/pre-commit` is a no-op for already installed delegates. The pre-push hook checks
formatting/lint on an isolated copy of each exact pushed commit. Pushes to `develop` and
`release/*` additionally run the complete desktop/mobile browser suite against that copy.
Install the pre-push hook with `pnpm hooks:install`. The installer leaves commit hooks untouched and refuses
unrelated existing hooks rather than replacing them. Hooks can be bypassed, so they do not
replace server checks.
Before opening a PR into `develop`, run `pnpm check:browser` and `pnpm test:browser` locally,
even when its source branch is a feature branch. Git has no local hook for a PR opened on GitHub.
Temporary source copies use the system temporary directory; no environment file is copied.

### Release lifecycle

Use `release/<version>` branched from `develop`, and choose the next development version
explicitly. Gitflow does not prescribe an automatic patch/minor/major increment. On that branch:

```sh
# Example versions, selected by the operator for this release
pnpm release:prepare 1.0.0 1.1.0-SNAPSHOT
```

This updates `package.json.version` to the stable release version and writes the reviewed next
version to `.github/release-plan.json`. Commit both files. It does not upgrade pnpm, commit,
push or deploy. Release PRs into `main` must use a real merge commit; squash/rebase merges,
feature PRs into `main` and direct pushes without release provenance cannot deploy.

After the merged `main` commit passes checks, production deploys when
`COURSELY_PRODUCTION_ENABLED=true`. The independent Gitflow job tags that exact commit as
`v<version>` and merges the release into `develop`, with `package.json.version` already set to
the explicit next SNAPSHOT in the same merge commit. Its message is exactly
`📷 <next-development-version>`. Existing tags are never moved.

Gitflow uses GitHub APIs with write permissions restricted to its own job. Technical
`automation/gitflow-*` refs preserve the initial base, merge staging tree and retry receipt;
they are not development branches and are not automatically deleted. Semantic conflicts stop
without touching `develop`. Publication of the merge and receipt is atomic and checks the
original develop SHA. Retry the same operation after a lost response; a receipt prevents a
second merge even if `develop` has subsequently advanced. A conflict requires operator review,
not an automatic retry against a different base.

Because writes using `GITHUB_TOKEN` do not trigger push CI, the job explicitly dispatches CI
for its exact resulting commit. The requested SHA must equal the develop event SHA before checkout;
if develop has advanced, the stale dispatch fails instead of checking another tree. Those checks
also gate the subsequent preview deployment.
A failed backmerge does not block an otherwise validated production upload. SQL/quiz namespace
state and HTTPS passkey acceptance remain separate operator checks; a CI result does not prove them.

### Deployment configuration

The production and shared preview targets are fixed in operator tooling. Production is the
Worker named in `scripts/production.ts`; preview is the distinct Worker in
`scripts/preview-deployment.ts`. Protected `develop` pushes and `release/*` pushes update the same
preview after successful checks; the last successful serialized upload wins. Opening a PR does
not deploy. Manual checks do not deploy production.

Repository variables: `CLOUDFLARE_ACCOUNT_ID`, `COURSELY_PRODUCTION_ORIGIN`,
`COURSELY_PRODUCTION_ENABLED`, `CAMPUS_PREVIEW_ORIGIN`, `CAMPUS_PREVIEW_ENABLED`.
The existing production secrets remain `BETTER_AUTH_SECRET`, `TURSO_DATABASE_URL`,
`TURSO_AUTH_TOKEN` and `CLOUDFLARE_API_TOKEN`. Preview uses separate
`CAMPUS_PREVIEW_CLOUDFLARE_API_TOKEN`, `CAMPUS_PREVIEW_AUTH_SECRET`,
`CAMPUS_PREVIEW_TURSO_URL` and `CAMPUS_PREVIEW_TURSO_TOKEN`;
its database URL is allowlisted and production database credentials are refused. The preview token
must have no production authority; verify the actual Cloudflare resource scope. A distinct secret
name alone does not enforce resource isolation. The current configuration shares the account ID
and fixes the preview origin. If token permissions cannot exclude the production Worker, keep
preview disabled: an isolated account requires a separate, reviewed account/origin configuration
change before enabling it. There is no fallback to the production token. Its quiz binding belongs
to the separate Worker, without a production `script_name`. Prepare its config with
`pnpm preview:prepare`, after setting the non-secret account and preview-origin variables.

Before enabling either deployment flag, verify the selected database migration journal and
configure its credentials/origin. A first upload creates the preview Worker. Its public HTTPS
address still requires teacher passkeys for private pages. Preview uploads finish with HTTPS
checks of anonymous privacy and database-backed reads of randomly absent public links.
Each route is logged before its request. Transport failures and HTTP 502/503/504 responses
receive at most three attempts, each with a 15-second timeout and a one- then two-second delay.
Unexpected access, redirect or cache behavior fails immediately. A failed post-upload check
does not roll back the Worker version already deployed.
Keep preview data fictional.
Configure branch protections or rulesets for the required checks and merge policy on `develop`
and `main`, accounting for the Gitflow job's scoped writes. Preview requires GitHub to report
`develop` as protected; release branches are exempt from this protection requirement. Every preview
upload requires the checked SHA to match the immutable event SHA, independently of repository scripts,
and a dedicated preview token. These gates do not configure merge policy.
The workflow uses repository variables and secrets without a GitHub environment or duplicate Cloudflare Workers Builds integration.

Quality and deployment build separately; the guarantee concerns the checked SHA, not promotion
of an identical binary. Pre-deployment smoke probes run locally and do not include anonymous
export probes.
Disable the relevant deployment flag to pause uploads; restoring a compatible prior Worker version
does not restore SQL or quiz-room data. Do not change stable production origin/rpID/auth secrets.

## Cloudflare

`wrangler.jsonc` uses the Workers adapter with `nodejs_compat`. `pnpm preview` runs the built
application locally on port 4173. No cloud deployment, Cloudflare Access/Zero Trust activation
or paid plan is performed by these local commands.

The chosen production observability offer is **Cloudflare Observability Free**. Under the
[pricing effective December 1, 2026](https://developers.cloudflare.com/observability/pricing/),
its ingestion allowance is 0.5 GB per day, shared by the account's included observability products,
with seven-day retention. Reaching that allowance stops new log/trace ingestion until 00:00 UTC;
there is no paid overage on Free, and that ingestion limit does not stop the application.
Production keeps logs sampled at 10%, traces at 1% and query-string redaction enabled. The
reviewed Free choice replaces the former December 1 deployment cutoff; it does not require
disabling logs or traces. Confirm the account's actual offer in Cloudflare before rollout:
repository configuration does not select or prove its billing plan.

## AI Configuration

Agent-host configuration, downloaded skills, design-tool state and browser captures remain local.
`AGENTS.md` and the product/design/glossary documents are the versioned project instructions.
Configure Svelte, browser automation and the scoped Campus MCP in the host as needed; no personal
MCP configuration is required to install, build or test the application. Optional skills guide
implementation when available; do not claim to have run an unavailable skill.

The official Svelte CLI is installed as a development dependency:

```sh
pnpm ai:svelte list-sections
pnpm ai:svelte get-documentation 'kit/hooks,kit/auth'
pnpm ai:svelte svelte-autofixer src/routes/+page.svelte
```

See `AGENTS.md` for conventions and checks. Browser artifacts in `.playwright-mcp/` are ignored.

## Data and Teacher Authentication Foundation

The active backend uses `@libsql/client/web` and Drizzle's web driver for Workers. Native libSQL
is used only by local tests and fixture generation. `src/env.ts` declares private runtime
variables; `.env.example` documents them without secrets. Missing configuration shows an unavailable state on the sign-in screen and makes authentication
endpoints fail closed with HTTP 503. Teacher home always requires a current teacher session.

The versioned migrations in `drizzle/` were designed for a **dedicated Campus database**, not the
old prototype. The following descriptions concern schema provenance, not current cloud status.
`0000_foundation.sql` creates the foundation; `0001_lonely_gateway.sql` adds module objectives
and the textual source-folder reference; `0002_brown_unus.sql` adds assessment retirement and
rubric-line descriptions. `0003_premium_tomas.sql` adds agent API keys and import receipts. `0004_lyrical_skullbuster.sql` adds correction proposal decisions; `0005_nasty_skrulls.sql` adds
publication revisions and retry receipts. Later migrations were also generated offline.
Migration files do not establish which migrations are applied remotely. Verify the selected
database's journal through an explicitly authorized bounded read before migration or rollout;
never rerun a migration command as a diagnostic probe. For the selected code commit, derive each
expected pair from `drizzle/meta/_journal.json`'s `when` value and the SHA-256 hash of the complete
corresponding SQL file. Compare these pairs, in journal order, with `created_at` and `hash` in
`__drizzle_migrations`; a row count alone is insufficient. Before migration, require an exact
applied prefix and review the pending suffix. Before rollout, require the complete expected chain,
with no missing, extra, duplicate or mismatched entries. Resolve discrepancies before proceeding.
New migrations require a reviewed compatibility plan and backup. Production CI provides the
automated journal, encrypted backup and migration sequence described above; other targets remain
explicit operator actions.
The `QuizRoom` SQLite Durable Object binding also requires a separate deployment;
local tests do not establish cloud readiness.
Modules, resources, assessment definitions, stable scoring lines, teaching-context calendars and publication
snapshots are durable. Deleting a yearly class cascades to its students, corrections, points,
proposals and semester comments; contexts retain their non-student history with `classId = null`.
`0006_chunky_dakota_north.sql` adds lifecycle records and retry receipts for the
[annual lifecycle](#annual-lifecycle).

Zod contracts define preparation, external links, structured calculation rules, correction
proposals and an explicit student-facing publication projection. Teaching services use stored revisions for conflict handling, transactions for related writes
and scoped identity checks for students, links and class contexts. Grading services use
`requireRosterEntry`, validate referenced assessments and check revisions before writes. The proposal
review, publication, final export and annual lifecycle share these domain checks. A database
JSON type alone is not runtime validation.

```sh
# Offline schema generation; no database mutation
pnpm db:generate

# New local fictional .db file only; does not load .env or contact Turso
pnpm db:fixtures
# An optional different local path is accepted; existing files are never overwritten
pnpm db:fixtures /private/tmp/campus-demo.db
```

Fixture data has twelve current fictional students, an older class and a module reused across
annual contexts, complete and incomplete corrections, absence and delay cases, retained retired scores
and a separate independent-result scenario. A separate publication module has a published snapshot
and a changed private link. It contains no usable login passkey. Functional UI checks
use a separate fictional local validation copy; production authorization remains enabled.

Better Auth is configured with the passkey plugin and Drizzle adapter. Public sign-up,
passwords, email delivery and account linking are disabled. Operator-issued teacher invitations
expire after 24 hours, are single-use and cannot assign another role. Each deployment has one
teacher account: invitation issuance checks this inside its write transaction and rejects a
different email when an account exists. Reinviting the same normalized email preserves its user ID
and replaces its pending invitation. Inspect existing accounts separately before rollout; this
guard does not remove accounts already present, and refuses invitations if another teacher exists.
Device verification is
required for registration and sign-in. Sessions last eight hours; the cookie cache is disabled
so revocation is checked against the database. HTTP cookies use HttpOnly and SameSite=Strict,
plus Secure on HTTPS. Origin checks and a shared atomic database rate limiter protect requests.

The server hook populates private session locals, and `requireTeacher` / `withTeacherDatabase`
authorize private teaching services before database access. `GET /api/session` requires a teacher session. Better Auth's
GET/POST handlers are mounted at `/api/auth/[...all]`; `POST /api/activation` exchanges a valid
invitation for a short-lived HttpOnly cookie. The approved vertical activation page at `/activation` verifies the invited identity and creates
a passkey; `/connexion` requests an existing key. Both open `/` after success. Private responses
use `no-store`; the home uses the authenticated name and its sidebar includes sign-out.
The home content now comes from the teaching database.

The following commands are **explicit operator actions**, not install/build/CI steps. They load
a locally configured `.env` and act on its dedicated Turso database:

```sh
pnpm db:migrate
pnpm auth:invite teacher@example.test "Teacher Demo"
pnpm auth:revoke teacher@example.test
```

Invitation details and a clickable private HTML invitation are written to ignored
`data/invitations/` files with private permissions; only the HTML file path is logged. Open that
file in your browser to start activation. Never paste its contents or link into chat or logs.
The token stays in a URL fragment until the page reads and removes it; it is never passed in a
query string or stored in browser storage. Reopen the original invitation after a page refresh
before activation is complete. To recover access, reinvite the same account. `auth:revoke` deletes
the account, invitations, passkeys and sessions; linked records such as agent keys, quiz runs,
calendar subscriptions and retry receipts can also be deleted through foreign-key cascades.
Remaining references may instead block the whole transaction. Never use revocation to change an
email address or recover access; an identity change requires a separately reviewed data-preserving
procedure.

One transitive `runed` version still declares a SvelteKit 2 peer range, while this project uses
SvelteKit 3. Superforms and Better Auth accept SvelteKit 3. Better Auth's integration deliberately uses
standard Request/Response handlers and the project's own hooks rather than version-specific
SvelteKit helpers; local types, WebAuthn tests and the Workers build check this integration.

## Acceptance boundaries

Real student data remains excluded until the launch requirements are evidenced. The public legal
pages still need operator-approved correspondence/telephone details and the responsible entity,
contact and adopted legal basis for class identification, grading/comments, live quiz answers and
focus/fullscreen events, accounting for minors. Complete the existing `mentions-legales` and
`confidentialite` pages without inventing a basis or institutional approval. Reconcile responsibility,
recipients, retention, rights and external AI-tool disclosures; preserve truthful quiz-name disclosures
and state that focus/fullscreen incidents do not automatically penalize grades. Verify the rendered
public pages contain no unfinished fields and remain reachable from collection notices, footer and terms.

Local unit, Worker and fictional browser checks do not establish deployed health or migration
state. HTTPS passkeys/MCP, the actual calendar feed, Worker capacity, screen readers, physical
devices and Safari/iPhone workflows need their own current acceptance evidence. Check these against
the intended deployment and current commit; record its source SHA, Worker version, origin/rpID,
selected database journal and quiz binding. Exercise actual passkeys, remote OAuth consent and
revocation, secure-context/Web Locks admission and representative concurrent quiz
open/start/save/reconnect/close/export flows with fictional participants. Verify durable
acknowledgements and capacity; migration commands are never diagnostic probes. Remote checks
require their own operator authorization. Old counts, screenshots and deployment receipts are
not a substitute. The historical Worker CPU-limit error (1102) did not recur in the current deployed
quiz acceptance. This observation does not establish its cause or a general capacity guarantee;
the accepted five-person trial and quota decision stand. The grade-transfer fix addresses the
per-invocation subrequest budget, independently of that historical CPU error.

### Recovery and rollback

Before using real student data, the operator records the source database, an isolated restore
destination, a UTC recovery point, acceptable data loss and recovery time, and the compatible
source SHA/Worker version. These tolerances require an operator decision. Rehearse with fictional
data, a new database and an isolated application/quiz namespace, without switching production.

**Turso rehearsal.** [Point-in-time recovery](https://docs.turso.tech/features/point-in-time-recovery)
creates a new database from automatic commit backups. Check the actual Turso offer: Free retains
24 hours, independently of the Cloudflare plan. PITR cannot recover a deleted source database.

1. Save fictional points and a receipt-backed operation such as a publication decision. Retain the
   exact command/receipt, revisions and teaching links locally. Record a UTC recovery time after
   those commits, then change the points to verify recovery of an actual past state.
2. Review the non-secret variables `CAMPUS_RESTORE_SOURCE` (fictional source), `CAMPUS_RESTORE_TARGET`
   (new, distinct database), `CAMPUS_RESTORE_GROUP` and `CAMPUS_RESTORE_AT` (RFC3339 UTC time).
   After authorizing that destination, use the authenticated Turso CLI:

   ```sh
   turso db create "$CAMPUS_RESTORE_TARGET" --group "$CAMPUS_RESTORE_GROUP" --from-db "$CAMPUS_RESTORE_SOURCE" --timestamp "$CAMPUS_RESTORE_AT"
   turso db shell "$CAMPUS_RESTORE_TARGET" 'PRAGMA integrity_check;'
   turso db shell "$CAMPUS_RESTORE_TARGET" 'PRAGMA foreign_key_check;'
   turso db shell "$CAMPUS_RESTORE_TARGET" 'SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at;'
   ```

3. Expect `ok`, no foreign-key violations and a journal matching the selected code revision; never
   run migrations as a diagnostic probe. Check restored roster, raw points, comments/revisions and
   public links. Replaying the exact saved command must return its receipt without a second effect.
4. Configure only the isolated application with the new URL and dedicated token. Record recovery
   point, elapsed time and results locally, without tokens or student data. Keep both databases
   until cleanup is approved; a production cutover remains a separately reviewed operator action.

**Quiz rooms.** Live answers, deadlines and receipts remain in `QuizRoom`; grades reach Turso only
after closure through `synchronizeQuizGrades`. A Turso restore cannot recover an unsynchronized
room. Cloudflare's
[per-object PITR API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api)
covers 30 days, but is unsupported locally. Campus has no room-recovery command: exercising this
requires separately reviewed operator access to the exact fictional namespace/room.

For an interruption with intact storage, reconnect the same participant to the same room without
clearing its credential. Keep pending commands and retry IDs until acknowledgement; a reload does
not preserve unacknowledged input, and the server deadline continues during an outage. If the room
closed but grade transfer was not confirmed, use **Retry the same decision** in the teacher interface.
Verify synchronization has no conflicts and inspect the expected marks in the saved correction;
the room's closed status alone does not establish that its grades reached Turso. If the room remains
unavailable or records disagree, preserve both stores and keep any SQL restore isolated. Do not reset
the room, replace the cohort or invent missing answers; the teacher decides the affected assessment.

Before any real cutover, reconcile room/cohort identity, answers, deadlines, scoring baselines and
SQL receipts. Preserve annual purge tombstones and subsequent deletions, publication decisions and
session/invitation/OAuth/key revocations. Keep the restore isolated until reconciliation is approved;
there is no assumed atomic SQL/DO recovery, transparent quiz resumption or accepted answer loss.

**Worker rollback.** Pause automatic deployment through the existing production flag and record
the active version. For the reviewed Worker, select **Deployments → known-good version → Rollback**
in Cloudflare. Confirm compatibility with the current SQL schema, room storage/protocol and bindings;
a Durable Object class lifecycle change can prevent rollback. Preserve origin/rpID/authentication
secret and reload open quiz clients when needed for protocol compatibility.
[Worker rollback](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
does not restore Turso/room data. Check HTTPS sign-in, private/public response boundaries and an
isolated fictional quiz before resuming. Preserve retry IDs after lost responses.

For a code-only rehearsal, record the full version UUID and source SHA for both the compatible
baseline and candidate, the initial automatic-deployment flag and the absence of a concurrent
deployment. Deploy the candidate, roll back to that baseline, then restore the same candidate at
100% traffic. Confirm the active version and HTTPS/private/public boundaries after each switch;
rollback propagation is not instantaneous. Use a fictional room across the switches and verify
acknowledged answers, participant identity and the original deadline before closing it and checking
grade synchronization. Do not run this exercise across schema, storage-format or object-class changes.

Record provider SQL restoration, service replay on a downloaded restore, intact-room continuity and
recovery after room-storage loss as separate results. A Turso fixture with empty quiz tables does not
prove live-room recovery. Code rollback does not restore data or establish a reconciled SQL/room
cutover. Local fixture copies, tests and Git snapshots are not provider recovery evidence; retain the
actual cloud exercise's recovery point, elapsed time and limits before real student-data launch.
Identify the incident owner and diagnostic locations, and exercise one alert or reporting path
alongside the restore/rollback rehearsal. Include session/key revocation and failed-deployment
handling. These are acceptance requirements, not evidence that recovery or alert delivery has passed.

## Preserved Backend Snapshot

The unapplied GitButler branch `wip/database-auth`, at
`c3f59e1291dc26df5a7536184786128e8beaaaf1`, preserves the complete source state before the earlier
backend extraction. It is an unapplied source snapshot, not a Git stash. Useful backend
files were selectively recovered and adapted to the current project; shared foundation and
UI files were not restored from that snapshot.

Do not apply the entire saved branch over the current workspace. To inspect an old file without
switching the workspace, use `git show wip/database-auth:<path>`. To deliberately reopen the
old complete workspace, preserve pending changes, create an operation snapshot, unapply the
active branches shown by `but status`, and then apply `wip/database-auth`. Do not apply both
snapshot workspaces together. Reinstall with the selected workspace's frozen lockfile.

The operation snapshot taken before this selective reintegration is
`e11770724813c8088b3ae65b459c97da581e60ef`. The original pre-extraction operation snapshot is
`6d5a4b484de940338204f9b0f208b10f1dec077c`. Both are recovery points, not cloud backups.

## Fictional browser workflows

Install frozen dependencies and ensure Google Chrome Stable is installed. The suite uses
Playwright's `channel: 'chrome'`; no bundled Chromium download is required.

Run the complete desktop (1440×900) and mobile (390×844, touch emulation) suite with:

```sh
pnpm test:browser
```

`pnpm check:browser` checks the runner and fixture tooling. `pnpm test` continues to run the
original Vitest suite. Filter browser cases with `pnpm test:browser --grep 'authentication'`;
pnpm 12 does not need an extra `--` separator.

Each scenario starts a fresh source copy and fictional local database under
`.svelte-kit/browser-fixture/`, served only on an owned loopback port. The browser/auth origin is
`http://localhost:<port>` and the server binds `127.0.0.1`. A private IPC fixture generates the
invitation and auth secret; no environment file, real account, student record or cloud database is
loaded. The only source override in the generated copy is its database adapter, which accepts
only that scenario's allocated file. Production source and authentication guards remain unchanged.

The tests activate and sign in through real virtual passkeys, retain drafts and conflicts, check
public snapshot privacy, and download and inspect the full-class PDF. They do not mock successful
authentication, persist cookies/storage state, or record traces/videos. Reports and fictional PDF
downloads stay ignored under `.playwright-mcp/browser-tests/`; fixture storage is removed on shutdown.

This Node/Vite fixture and viewport emulation do not prove HTTPS Cloudflare acceptance, physical
phone behavior or VoiceOver support. Those checks remain separate. CI retains the credentials-free
production Workers smoke check and uploads no browser credentials, traces or database copies.
