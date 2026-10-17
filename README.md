# Coursely

The current approved scope is [the 15 October teacher workflow](docs/plans/2026-10-15-teaching-workflows.md): one class per active module, independent copies, equal-weight normalized quizzes, targeted MCP patches, two private PDF projections and manual annual close with stable public links. Earlier milestone narratives below are historical; the current guides describe the implemented contracts. Migration `0008_lucky_puppet_master.sql` is generated offline; no existing/cloud database was migrated.

SvelteKit 3 / Svelte 5 / TypeScript foundation with shadcn-svelte, Tailwind CSS 4 and Cloudflare
Workers, with the approved Turso/Drizzle data foundation and invitation-only teacher passkeys.
The French teacher home, annual classes and reusable module drafts now use private teaching
services. Classes support a shared editable roster and paste/CSV import; modules support
preparation, selected links and class calendars. Private rubric editing, calculations, the grade grid
and detailed correction are implemented. Private MCP correction proposals and their teacher review are active. Teacher publication review and public class/module pages are implemented. Further business features follow the approved lots. See the
[business integration plan](docs/plans/2026-10-12-business-integration.md).

## Getting Started

Use Node **26.11.1** (`.node-version`) and pnpm **12.11.2** (`packageManager`).
Dependency versions are resolved in `pnpm-lock.yaml`.

Production preparation and deployment after successful main-push CI are documented in
[the launch guide](docs/production.md). Local preparation never deploys or provisions remote services.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Without database credentials and authentication secrets, the sign-in page shows an unavailable
state and private pages remain inaccessible. A usable teacher workspace requires the dedicated
database migrations and a teacher passkey. Existing private local files are ignored by Git and
must not be committed. Local fixture previews are separate validation copies, not an authentication
bypass in this project.

## Development and Validation

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm preview
```

`vite.config.ts` configures SvelteKit, Tailwind and the Cloudflare adapter. The separate
`vitest.config.ts` runs Node-based tests for domain validation, roster imports, Paris calendar
conversion, rubric replacement, grading calculations, correction forms and private teaching services,
local MCP imports and agent API-key access, alongside the original greeting example.
It also runs local migration, database-constraint and cryptographic WebAuthn integration tests
against isolated in-memory libSQL databases. Tests never load local environment files or contact Turso.

Strict TypeScript mode is enabled. `checkJs` is disabled to prevent Wrangler-generated types
from importing and analyzing built JavaScript bundles in `.svelte-kit`. TypeScript checks the
application, and ESLint also checks JavaScript configuration files. `check` and `build`
automatically regenerate Workers types.

## Teacher Workspace

The selected “Prochaine intervention” home composition uses stored module summaries and the next
lesson. Its module search opens the actual draft editor. Narrow layouts use a module list and a
mobile navigation sheet. Notation opens the private grade grid.

`/enseignant/classes` selects a class and academic year, with its common roster beside associated
modules. Create or edit a class; add, rename or remove a student; preview pasted names or a CSV
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

The approved code-led Impeccable compositions are `rubric-table`, `grid-split` and
`correction-bottom-summary`. Their choices and proposal history remain in
`.impeccable/mocks/lot3-design-round.json` and the three grading surface briefs.

`/enseignant/modules/[moduleId]/bareme` edits evaluations, groups, scoring-line labels,
optional rubric descriptions and integer maxima. Group and evaluation totals derive from the
lines. Results use validated structured rules: weighted components or raw-point aggregation,
with multiple independent /20 outputs. Formative evaluations are excluded from result rules.
Class-context deadlines and submission instructions are edited here in Paris local time.
The example 15/25/60 weighting is a fixture, not a product-wide formula.

`/enseignant/notation` selects a module and annual class; `module` and `contexte` query parameters
retain this context. Search and completion filters narrow the roster. On desktop the results
grid sits beside the selected student's assessment summary; narrow layouts use labeled rows
and an in-flow summary. Open `/enseignant/notation/[contextId]/[studentId]` for criterion points,
submission details and direct previous/next student navigation.

Corrections distinguish À évaluer, Noté, Absent injustifié and Absent justifié / rattrapage.
Blank points remain missing; decimals are rejected. Absence disables inputs while preserving
raw points. Unjustified absence resolves the assessment to zero; justified absence keeps it
pending. Internal calculations retain precision; /20 marks display one decimal. Quiz sections contain one score line per Wayground quiz. Each quiz is normalized to /20 and
contributes equally to the section average, regardless of its maximum. Missing or invalid required
scores keep a result pending or invalid.

Project delay compares deadline and submission dates in Europe/Paris calendar days. It subtracts
one point per Paris calendar day for delays of one to five days from the project /20 mark;
beyond five days the project is zero. Explicit exceptions and raw points are retained. The teacher chooses an exemption or refusal explicitly; refusal resolves the project
to zero. A private semester comment has its own save and copy actions. It is separate from scoring;
there are no private criterion-justification fields.

Rubric replacement keeps stable line IDs and raw points: 8/10 becomes 8/20 when the maximum changes.
New lines remain pending. Excess points are flagged and never clamped; removed lines and assessments
keep their raw history outside the active calculation. Saves are explicit. Dirty navigation asks
before discarding edits; save errors and HTTP 409 conflicts retain the draft. On supported desktop
sizes the context and lower result summary remain visible while criteria, retired-score history,
submission/comment panels and diagnostics scroll within the work area. The summary keeps concise
issue counts; complete calculation diagnostics appear once in the work body. Narrow screens reflow
these sections in document order. Formsnap associates each point input with its rubric description,
maximum/range guidance and errors.

Teacher-only PATCH endpoints update the module rubric, one student's assessment correction or the
separate semester comment. They require the same origin and strict payloads, scoped class membership
and assessment identities, and transaction-backed revision checks for rubrics, contexts, corrections
and comments. Final module PDF export is implemented; annual archive and purge are implemented locally. See `docs/grade-export.md`.

### Module Publication and Student View

Open **Publication** from a saved module to review its student-facing sections for one class/year.
The reconfirmed Impeccable designs are `publish-sections` and `student-tabs` (Un bloc à la fois).
The public page shows one of five tab panels below the title and description. Its deadline and
project-document rail remains visible across selections; narrow screens reflow these references
below the selected content. The private compact review shares the same snapshot-content renderer. Document labels and named actions are
separate; a PDF badge appears only when the selected URL provides that evidence. The private compact
review keeps all source content and its explicit publication decision visible on the reference desktop
size, with internal scrolling for longer content. The private section navigation reflects the current section; public tabs identify the selected panel.
Formsnap/Superforms/Zod wire the context
selection and publication decision; publishing and confirmed unpublishing are explicit teacher actions.

The previous snapshot stays public during draft edits. Module/context/class/publication revisions
prevent an older review from publishing unseen changes, and identical retries have transactional
receipts. Public `/modules/[contextId]` and `/classes/[classId]` pages need no account and expose only
validated published content, without rosters, grades, private preparation or auth state. Module and class links
stay stable through a continued annual closure. Paused modules retain private content and disable
their public link until recovery and manual publication; uncontinued classes lose their directory.
Public errors and pages are uncached and request no indexing. Legacy snapshots require review and
republication; they never expose a draft as fallback.

Read [the publication guide](docs/publication.md) for the workflow, retention, migration and Drive
boundary. Coursely stores links only; publishing does not change Drive permissions, and a replacement
at an already shared file URL becomes visible independently of the publication button.

### Local Module MCP

The local stdio server provides six module tools: `inspect_module_folder`, `get_import_context`,
`bind_module_folder`, `create_module_draft`, legacy `update_module_draft` and targeted `patch_module_draft`. It writes private drafts
through the same transaction-backed services as the teacher editor. These six module tools have no correction, roster, publication or Drive operations. No new page
is added; imported modules are reviewed in the existing editor.

See [the local import guide](docs/module-import.md) for the contract, durable local keys, retry
behavior and operator setup. The project MCP configuration grants access only to the selected
fictional folder `data/mcp-demo`. Its example has no real course or student data. Adding a real
module folder requires selecting that precise path; do not expand access to all teaching folders.

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

`drizzle/0003_premium_tomas.sql` adds hashed API keys and import receipts. It was generated offline
and is not applied to Turso. A real installation needs the pending migrations and an operator-issued
key before authenticated tools can reach its database. No real key, migration or deployment was
performed in this phase.

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
fresh; request a new proposal with current baselines. A teacher session, same-origin check and strict
server validation are required for decisions. An API key cannot accept or refuse a proposal.

Refusal does not change recorded scores; a pending proposed comment is kept, while an already
explicitly accepted comment remains recorded. Replayed decisions return the original receipt and
never reapply points after a later manual correction. Proposal payloads and their ID/hash-only
decision ledger are removed with their annual student/class data. Reusable module material survives.
`drizzle/0004_lyrical_skullbuster.sql` remains offline and unapplied to Turso. It retains old version-1
proposals for consultation/refusal; they must be regenerated before acceptance.

See [the correction proposal guide](docs/correction-proposals.md) for operator setup, input shape,
retry/conflict behavior and the local validation boundary. No real correction key, cloud migration
or deployment was performed.

### Formsnap, Superforms and Zod

Teaching mutation forms use the project's shadcn-svelte Form components backed by Formsnap 2,
Superforms 2 and Zod 4. `Form.Field`, `Form.Control`, `Form.Label`, `Form.Description` and
`Form.FieldErrors` associate controls with their labels, help and validation errors. Client
validation uses `zod4Client`; strict server Zod contracts remain authoritative.

These forms call the existing teacher-only JSON API through an explicit submit handler, rather
than introducing SvelteKit form actions. Each form has one typed Superforms store; the semester
comment is a separate form. Typed field proxies handle nested resources, lessons, rubric lines and
scores, including row removal. Preserve the API's
revision, pending-state and error handling when adding fields.

Superforms 2.31.0 declares SvelteKit 1/2 peers and still imports the removed `$app/stores` module.
With this project's SvelteKit 3, `src/lib/compat/superforms-kit3.ts` supplies lazy readable stores
from `$app/state` through an exact post-order Vite alias. It avoids a shared request-specific SSR
store. Local SSR, client navigation, saves, conflicts, types and the Workers build verify this
adaptation; it is not a claim of upstream SvelteKit 3 support. Remove the bridge once the installed
Superforms release supports this stack directly. Existing peer warnings remain visible.

## Continuous Integration

The GitHub Actions workflow in `.github/workflows/ci.yml` runs on pull requests, pushes to
`main` and `develop`, and manual dispatch. Its `Quality checks` job installs dependencies
with the frozen lockfile, checks formatting and lint, checks types, runs unit and local integration tests, builds the
Cloudflare Worker and verifies that the local Workers preview serves sign-in, redirects anonymous visitors away from teacher home and refuses an
anonymous request to the private session endpoint. It also checks private class/module page
redirects and refuses anonymous JSON writes to teaching endpoints before payload validation.
Agent reads/writes also refuse missing keys with HTTP 401, and public API-key management returns
HTTP 403; all these responses are uncached.

Node is read from `.node-version`, and pnpm from `packageManager` in `package.json`. Actions are
pinned to immutable commits. The pnpm store is cached; superseded quality jobs may be cancelled.
Quality checks have a 30-minute limit. Repository permissions remain `contents: read`, and quality
checks receive no production secrets.

After a successful push CI on `main`, the separate `Deploy mds` job deploys that same commit when
`COURSELY_PRODUCTION_ENABLED=true` is configured in repository variables. PRs, `develop`, failed
checks and manual dispatch never deploy. Deployment jobs are serialized without cancelling an
in-progress upload, and an old queued commit is skipped if main has advanced. Production secrets
are injected only in the final deployment step, after the build and dry run. No GitHub environment,
paid branch protection or parallel Cloudflare Workers Builds connection is required. This local
preparation has not enabled the pipeline remotely; see [the activation guide](docs/production.md).

## Cloudflare

`wrangler.jsonc` uses the Workers adapter with `nodejs_compat`. `pnpm preview` runs the built
application locally on port 4173. No cloud deployment, Cloudflare Access/Zero Trust activation
or paid plan is performed by these local commands.

## AI Configuration

The project retains its Svelte and Playwright MCP configuration and adds the scoped local Coursely MCP. Playwright is pinned to
`@playwright/mcp@0.0.83` and launched on demand through `pnpm dlx`; it does not require a
Playwright test dependency in this project. Context7 can be used when supplied by the agent host.

The `svelte-code-writer`, `svelte-core-bestpractices`, `shadcn-svelte`, Better Auth and other
existing skills guide implementation. Skills load on demand and are managed by their installers.

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

The versioned migrations in `drizzle/` target a **new dedicated Coursely database**.
`0000_foundation.sql` creates the foundation; `0001_lonely_gateway.sql` adds module objectives
and the textual source-folder reference; `0002_brown_unus.sql` adds assessment retirement and
rubric-line descriptions. `0003_premium_tomas.sql` adds agent API keys and import receipts. `0004_lyrical_skullbuster.sql` adds correction proposal decisions; `0005_nasty_skrulls.sql` adds
publication revisions and retry receipts. All later migrations were generated offline and remain
unapplied to Turso.
Apply all pending migrations explicitly before using the new teaching screens against a configured
database. Do not apply them to the old prototype database. Modules, resources,
assessment definitions, stable scoring lines, teaching-context calendars and publication
snapshots are durable. Deleting a yearly class cascades to its students, corrections, points,
proposals and semester comments; contexts retain their non-student history with `classId = null`.
The annual lifecycle UI uses the approved continuous dossier. See `docs/annual-lifecycle.md` for archive/reopen, read-only history, exact-year Formsnap confirmation and atomic purge. `0006_chunky_dakota_north.sql` adds lifecycle records and retry receipts; it remains unapplied to Turso.

Zod contracts define preparation, external links, structured calculation rules, correction
proposals and an explicit student-facing publication projection. Teaching services use stored revisions for conflict handling, transactions for related writes
and scoped identity checks for students, links and class contexts. Grading services use
`requireRosterEntry`, validate referenced assessments and check revisions before writes. The proposal
review and public course routes are implemented; Final module PDF export is implemented; annual archive and purge are implemented locally. See `docs/grade-export.md`.
The local module MCP is implemented. A database
JSON type alone is not runtime validation.

```sh
# Offline schema generation; no database mutation
pnpm db:generate

# New local fictional .db file only; does not load .env or contact Turso
pnpm db:fixtures
# An optional different local path is accepted; existing files are never overwritten
pnpm db:fixtures /private/tmp/coursely-demo.db
```

Fixture data has twelve current fictional students, an older class and a module reused across
annual contexts, complete and incomplete corrections, absence and delay cases, retained retired scores
and a separate independent-result scenario. A separate publication module has a published snapshot
and a changed private link. It contains no usable login passkey. Functional UI checks
use a separate fictional local validation copy; production authorization remains enabled.

Better Auth 1.7.7 is configured with the passkey plugin and Drizzle adapter. Public sign-up,
passwords, email delivery and account linking are disabled. Operator-issued teacher invitations
expire after 24 hours, are single-use and cannot assign another role. Device verification is
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
before activation is complete. Revocation deletes the account, invitations,
passkeys and sessions. No real invitation or cloud migration was performed while implementing
this foundation.

The installed Better Auth package declares a SvelteKit 2 peer range (the existing `runed`
dependency does too), while this project uses SvelteKit 3. The integration deliberately uses
standard Request/Response handlers and the project's own hooks rather than version-specific
SvelteKit helpers; local types, WebAuthn tests and the Workers build check this integration.

## Historical Acceptance Evidence

The publication/student-view part of lot 5 passes **203 tests across 27 files**, including 29
publication, access, hook and migration checks. Svelte/application and operator types report zero
errors/warnings; formatting/lint and the Workers build pass. The CI preview checks now include
private publication access, anonymous publication refusal, invalid public links and unavailable
public readers. All **21** production-source local Workers HTTP checks pass in a copy without secrets
or fixture authentication seams. The key-management check sends JSON from the same origin so it
reaches the application guard rather than SvelteKit's earlier form-CSRF rejection.

Fictional browser checks cover a saved draft differing from its public snapshot, explicit publication,
confirmed unpublication, the empty class directory, republication at the same link, second-window
HTTP 409 retaining the reviewed preview, and deliberate reference refresh. Required captures cover
1440×900, the ambient 1280px width, 810px tablet and 390px mobile; dark, section, conflict and error
supplements are included. The core screenshot backend reflowed one mobile class capture; native
recapture corrected the evidence without changing application code. Mobile contents opens at the
keyboard and its deadline anchor moves the target to a 24px top inset. The link-copy action reports
success; the browser bridge did not provide independent clipboard contents for that check.

The approved public reading layout is **Un bloc à la fois** (`student-tabs`), with
**Vérification par section** (`publish-sections`) for publication. The public page uses five
shadcn-svelte tabs, one visible panel and a persistent deadline/project rail; the private preview
retains all sections. Keyboard arrows, Home/End, 44px controls, panel labeling, light/dark and
320–1936 px reflow were checked. Historical evidence remains in
`.impeccable/review/lot5-student-tabs/`; screen-reader, real-device and final HTTPS acceptance remain
outstanding. See [the publication guide](docs/publication.md) and
[the production checklist](docs/production.md).

The module-import part of lot 4 passes **139 tests across 20 files**, including 34 new agent/MCP
checks. Installation with the frozen lockfile, types, formatting/lint and the Workers build pass.
Real stdio tests create and update fictional modules through a local HTTP API; lost-response
replays, stale conflicts, rollback, raw points, scoped keys and quota/revocation are checked.
An isolated production-source Workers preview passes nine HTTP checks, including the three
anonymous agent routes at 401 and operator-only key management at 403, with no-store responses.
The registered command also inspects the selected fictional folder without a connection file.
No real key, cloud migration, deployment or course-folder access was used. Authenticated real
activation remains pending; see the local import guide.

The latest lot 3 validation reports 105 tests across 16 files, application/Svelte and operator-script
TypeScript checks with zero errors or warnings, formatting/lint and the Cloudflare build passing.
Local tests cover grading calculations, rubric changes, access/membership and revision handling.
Manual fictional-data checks rejected decimal points, disabled/re-enabled absent scoring, retained
a draft after cancelling dirty navigation, persisted an explicit save after reload and retained
an older window's draft on HTTP 409. Earlier class/module acceptance remains recorded in the plan.

Required captures cover rubric, grid and correction at 1440×900, 390×844 and 810×1224, with full-page
supplements and a dark correction sample. The fresh Impeccable reviewer used the degraded role
contract: its full surface review matched rubric/grid fidelity and identified two correction fixes.
The maximum association and desktop summary persistence were fixed in two batches. The final `ship`
verdict scores those two fixes only; it is not a second full-surface review or a server/domain audit.
Long-group and keyboard supplements keep the pending result name, state, issue count and Save action
visible, with complete diagnostics in the scrolling work body. Temporary extra criteria were removed.

Evidence is in `.impeccable/review/lot3/`: `verification.json`, `worker-smoke.json`,
`root-autofixer.json`, `layout-final.json`, `fix-layout.json` and `finish-review.md`.
`layout-final.json` contains the initial geometry, including the pre-fix summary; use `fix-layout.json`
and the final review/captures for the persistence correction. The production-source Workers smoke
returned sign-in 200, private grading page redirects to sign-in and an anonymous same-origin comment
write 401, all with private/no-store responses. Real-device, screen-reader and full HTTPS passkey
acceptance remain outstanding. No cloud migration, deployment or real student data was used.

### Incumbent Design Documentation Check

The shipped documenter role was unavailable in this harness; this pass used the project's
`.agents/skills/impeccable/reference/degraded/documenter.md` and `reference/document.md`.
The ordinary-extension documentation pass compared `PRODUCT.md`, `DESIGN.md` and
`.impeccable/design.json` with `src/routes/layout.css`, the shared Button/Input primitives,
`RubricEditor.svelte`, `GradeGrid.svelte`, `DetailedCorrectionDraft.svelte` and `CriterionScore.svelte`.
It also checked `src/lib/domain/{grading,grade-calculation}.ts`, the grading forms and services,
private page loaders/PATCH endpoints, the three grading briefs and the approved sketches
`.impeccable/mocks/decision/lot3-{rubric-table,grid-split,correction-bottom-summary}.html`.
Opened proof samples were `{rubric,grid,correction}-{desktop,mobile,user-810}.jpg`,
`correction-mobile-full.jpg`, `correction-dark-full.jpg`, `correction-long-group.jpg` and
`correction-long-group-keyboard.jpg`, alongside the verification and review records above.

The neutral OKLCH tokens, Inter hierarchy, rounded controls, borders, 44px control floor and reduced
motion still match the incumbent system. `DESIGN.md` and its sidecar are preserved. Pre-existing
prose describes home grading data as fictional and the grade preview as demonstration-only;
the sidecar includes historical preview specimens. Those descriptions do not describe the new
private grading workflow. No new world, token change or repair of that historical drift was approved
or canonized in this pass.

## Preserved Backend Snapshot

The unapplied GitButler branch `wip/database-auth`, at
`c3f59e1291dc26df5a7536184786128e8beaaaf1`, preserves the complete source state before the earlier
backend extraction. It is a GitButler stash, not an entry in `git stash list`. Useful backend
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

After installing frozen dependencies, install the pinned Chromium once:

```sh
pnpm exec playwright install chromium
```

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

Sandboxed local execution can install and run with an owned cache, for example
`PLAYWRIGHT_BROWSERS_PATH=/private/tmp/coursely-improve-playwright-browsers`. Use the same value for
installation and subsequent browser commands. macOS Chromium may require native process permissions.

This Node/Vite fixture and viewport emulation do not prove HTTPS Cloudflare acceptance, physical
phone behavior or VoiceOver support. Those checks remain separate. CI retains the credentials-free
production Workers smoke check and uploads no browser credentials, traces or database copies.

The first complete local macOS run passed all 16 cases in 14 minutes 59.642 seconds. CI allows
30 minutes for the complete quality job, including dependency/browser installation, other checks
and the Workers smoke test. This run did not execute GitHub Actions; Ubuntu duration remains
unmeasured.
