# Implementation plans

Prepared with the repository `improve` skill on 2026-10-13 against commit `e0adfff` and the
uncommitted GitButler workspace. Léo selected the recommended findings 1–5 and the browser
prerequisite (finding 6), then requested French/EU privacy requirements. Initial execution used
the separate checkout described below. Following Léo's explicit reintegration request, the
43 approved files are now present as uncommitted changes in the GitButler workspace.

## Execution order and status

Numbering follows execution order, not the original finding numbers.

| Plan                                    | Title                                   | Audit finding | Priority | Effort | Depends on | Status |
| --------------------------------------- | --------------------------------------- | ------------- | -------- | ------ | ---------- | ------ |
| [001](001-final-mark-boundaries.md)     | Valid final-mark PDF boundaries         | 1             | P1       | S      | —          | DONE   |
| [002](002-expire-auth-rate-buckets.md)  | Expiring authentication quota buckets   | 2             | P1       | M      | —          | DONE   |
| [003](003-proposal-queue-queries.md)    | Proposal titles without per-row rubrics | 3             | P2       | S      | —          | DONE   |
| [004](004-repeatable-browser-tests.md)  | Repeatable fictional browser tests      | 6             | P1       | M–L    | —          | DONE   |
| [005](005-recover-module-creation.md)   | Recover committed module creation       | 4             | P1       | M      | 004        | DONE   |
| [006](006-propagate-session-cookies.md) | Forward session-renewal cookies         | 5             | P1       | S–M    | 004        | DONE   |

Status vocabulary: TODO, IN PROGRESS, DONE, BLOCKED with a precise condition, REJECTED with a
reason, or STALE when source drift requires plan revision. Executors record their checks and
change summary when updating a row; a reviewer may maintain rows for dispatched executors.

## Dependencies and boundaries

Execute 001 → 002 → 003 → 004 → 005 → 006. The first three have no hard dependency on each other.
004 supplies actual-browser regressions for 005 and 006. Completing 005 is not a technical
prerequisite for 006, but the agreed sequential order keeps reviews focused.

The browser foundation is more involved than a standalone scenario: its estimate is refined to
M–L because it needs disposable database substitution, real virtual-passkey authentication,
PDF content assertions and CI. It does not replace production Workers HTTP/HTTPS acceptance.

Each plan inlines its source evidence, style, scope, test pattern, commands, privacy boundaries
and STOP conditions so it can be assigned independently. No source code may be edited by the
advisor. Executors must preserve pending work and use GitButler for requested Git mutations.
No automatic pushes, merges, snapshot application or operator actions.

## Privacy and operator context

[PRIVACY.md](PRIVACY.md) records the dated French/EU legal references and operational decisions.
Léo confirmed individual use under his responsibility, with his own account/data currently.
He clarified on 2026-10-14 that he is a full-stack developer and external training provider,
using his own initiative to organize courses and display teaching material. His selected annual
retention is one year after the end of the school year; corrections remain entirely offline on
his PC, according to his declaration. These facts update the dossier, not the app's purge logic.
The model's future student identities/results remain personal data even without student accounts.
No institutional mandate, provider contract or real database was inspected.

[privacy-decisions.json](privacy-decisions.json) keeps pre-real-student-use decisions explicit.
They can be prepared while technical plans run against fixtures. Passing plans does not mark
deployment, student imports or new external processing authorized or compliant. New legal UI,
architecture changes or provider choices require their own scoped decision/design process.

## Baseline and verification

Much of the audited source is untracked; `e0adfff` does not fully describe it. The immutable
[baseline.json](baseline.json) records SHA-256 values for reviewed source/config inputs.
Run `node plans/check-plans.mjs` to validate the dossier, and
`node plans/check-plans.mjs --baseline 001` (replace the ID) before an executor starts.
Exit 0 means the scoped baseline files match. Exit 1 means inspect the reported paths and the
plan excerpts. Changes from an earlier completed plan are expected only where documented; record
that reconciliation in the index rather than silently overwriting the baseline.

Audit verification already run: 231 tests in 32 files passed; lint passed; read-only Svelte check
and operator TypeScript check passed with zero diagnostics; two read-only Svelte autofixer analyses
were clean. Dependency audit found zero high/critical advisories and two moderate advisories.
Cloud/HTTPS, current browser rendering, physical devices and screen readers were not verified.
After planning, only dossier validation/format checks are required; source tests need not be
rerun until implementation changes their inputs.

## Findings considered and rejected or deferred

- Raw points above changed maxima, retired scoring history, exact old decision receipts,
  snapshots surviving annual class deletion and current-rubric archived exports: approved behavior.
- Pending Turso migrations and request-local Superforms Kit 3 compatibility bridge: intentional;
  no migration or dependency upgrade is part of these plans.
- Duplicate class creation after retry: normalized-name uniqueness already rejects duplicates.
- API-key management route encoding bypass: not confirmed against installed routing behavior.
- Additional rubric indexes and batched scoring writes: defer until measured benefit justifies them.
- Finding 7, bounded activation JSON: not selected in this six-plan set; retain it as a pre-use
  security action/risk decision, not as a completed fix.
- HTTPS lot 7 and actual professional Drive sharing/version rehearsal: grounded future work,
  not implemented here and not represented as bugs.
- Generic UI primitives, generated/vendor artifacts and live cloud infrastructure: not exhaustively audited.

## Execution evidence

Execution authorized on 2026-10-13. Changes are implemented and reviewed in the detached worktree
`/private/tmp/coursely-improve-execution-20261013`, based on the current uncommitted foundation.
No secrets or real records were copied. DONE records the independent review in that checkout.
On 2026-10-14, Léo requested transfer into GitButler: 23 reviewed existing files and 20 new files
were copied exactly, with originals backed up privately. All 43 are visible in GitButler's
uncommitted changes. Branches and commits remain untouched; no Git merge, deployment or cloud
migration was performed. `plans/execution-start.json` in the execution checkout records the
pre-execution foundation; statements below about preserved original hashes refer to that review
stage. [reintegration.json](reintegration.json) records the subsequent authorized transfer.

Reintegration checks in the workspace passed: 309 unit tests in 36 files, lint, Svelte/application
types (zero errors/warnings), browser types and operator-script types. New dependencies were
installed from the exact frozen lockfile with lifecycle scripts disabled. Verification used an
empty envDir without loading private env files; generated Kit types were prepared before the
successful unit rerun. Temporary verification configuration was removed. Transferred hashes match
the reviewed source; all unrelated foundation files are unchanged. The complete browser suite
and Workers build were already verified in the byte-identical isolated source and were not
repeated for this file transfer. Privacy decisions remain PENDING.

001 — APPROVED after independent review of the four scoped file diffs. Final marks normalize only
negligible out-of-range noise; valid in-range precision, raw totals and strict export validation
remain intact. Regression coverage includes awkward integer/decimal/near-100 weights, all twelve
fictional students and incomplete/invalid export blocking. Reviewer reran 37 focused tests and
248 full tests, lint, check (zero diagnostics) and build: all passed. Existing PDF chunk warning
remains; generated Worker types restored to their starting hash. Original source hashes unchanged.

002 — APPROVED after independent scope/diff review and 38 focused / 262 full passing tests,
lint, check (zero diagnostics) and build. Security metadata older than one hour is drained in
deterministic batches of at most 100; unsupported windows at or above that horizon fail before DB
operations. Concurrent quotas and cleanup-failure behavior remain authoritative. EXPLAIN verifies
a covering expiry index without full scan or temporary sort. Real-handler unknown-route buckets
expire without changing sessions or fictional students. Generated migration `0007_true_shadow_king`
contains only that index and remains unapplied to Turso. A new test's overloaded mock annotation
was corrected before the clean final type check; no source-policy deviation.

003 — APPROVED after independent full diff/test review and 40 focused / 272 full passing tests,
lint, check (zero diagnostics) and build. Measured SELECT counts changed from 26/103 to 19/19
for one/twelve proposals, both with repeated and distinct modules; regressions assert zero growth.
Queue reads now select only metadata and scoped titles. Retired/cross-module fallback, ordering,
comment-only pending rows, explicit decided selection and missing-module fail-closed behavior
are covered. Selected-proposal validation is unchanged. Only the two scoped files changed;
nullable-title typing was resolved before final gates. Production latency was not measured.

004 — STOPPED at the browser core gate after two attempts. Fixture isolation passed both
viewports; desktop real passkey activation/sign-out/sign-in and actual-roster public privacy
passed. The corrected draft case timed out because the preparation tab did not become selected.
No page-error/module diagnostics were captured, so cause is not yet established. Remaining
business/PDF cases, two clean full browser replays and final gates are pending; 005/006 await 004.
Owned scratch paths were cleaned, Worker types restored/unchanged and application source remained
unchanged during 004. Reviewer is investigating before revising the dispatch. Native Chromium
required sandbox escalation for macOS Mach services; automatic review allowed that isolated run.

004 reconciliation on 2026-10-14 adds a diagnostic gate to obtain missing client errors and
fixture-stage timings before another functional retry. Existing scoped tooling/dependency changes
are expected partial implementation; initial source hashes are not reset. Production changes
remain outside 004. The stopped run is retained as evidence, not counted as browser completion.
The drift checker reports exactly the four expected partial tooling files: package manifest,
installer-owned lockfile, CI workflow and README. Their diffs were reviewed before diagnostic
resumption; application source, Vite config and existing migrations still match the 004 start.

004 diagnostic probe — one desktop probe passed real activation and a fresh-SSR editor tab
interaction, with zero captured client errors or failed module requests. This does not validate
saved drafts/conflicts. Measured setup: copy 149 ms, migrations 9 ms, seed 221 ms and Vite readiness
40,459 ms; SQLite changes are not justified. Reviewer authorized only the affected functional
desktop case next, then the original remaining gates if it passes. No production changes inferred.

004 affected functional gate subsequently passed desktop save/reload and real HTTP 409 draft
retention in 59.6 s. Mobile readiness uses the existing native section select. Original core/PDF
and full replay gates are resumed; the plan is still incomplete until their results are reviewed.

004 resumed core gate passed all 12 desktop/mobile cases in 11.5 minutes; the separate PDF gate
passed both viewports in 2.0 minutes. Incomplete export is blocked, and the real downloaded PDF
includes all twelve names/results/accents despite a one-row filter, without private markers.
The executor is running the first complete 16-case suite. The reviewer will run the second
complete suite independently after full diff review; both use new fixtures. Full completion,
final gates and the measured CI budget remain pending.

004 first complete suite passed 16/16 in 899,642.124 ms (14 min 59.642 s), with no skipped,
flaky or unexpected cases. This is local macOS evidence; GitHub Actions was not run remotely.
Reviewer authorized the quality job's timeout increase from 15 to 30 minutes, preserving all
steps/permissions. Review also identified equal parent/child termination budgets; the executor
is correcting that lifecycle race and testing shutdown of its own suspended Vite process.
The independent second full replay and final verdict remain pending.

004 — APPROVED after independent full diff/scope review, lint, unit tests, application check
(zero errors/warnings), browser types and Workers build, all exit 0. The reviewer independently
ran all 16 desktop/mobile cases from fresh fixtures: 16 passed in approximately 15.0 minutes,
including the final suspended-server shutdown guards. Both complete runs passed; final lifecycle
assertions also passed separate executor reruns. The exact Playwright/PDF dependencies add no
existing-package upgrades. Only four existing tooling/docs/CI files and thirteen new harness
files changed. Original application source, Vite/Wrangler configuration and existing migrations
match the 004 start; Worker types are restored, scratch empty, artifacts ignored/untracked.
No source drift in the original 416-file foundation outside plans, no commits or cloud actions.
Physical-device, VoiceOver, deployed HTTPS and remote GitHub Actions checks remain outside evidence.

005 — Dispatched against the approved 004 harness. Its application/API/service-test files still
match the original foundation. Plan refinement adds minimal request-error provenance so an
undecodable rejection cannot be mistaken for proof of no write, and checks recovery identity and
reload after a recovered ID remains on the new-module route. These are local reliability details,
with no new screen, persistent draft store or server replay-policy change.

005 reproduction — the unchanged editor committed a real fictional POST, lost its response,
then replayed changed title/preparation with the same ID and received actual HTTP 409. The test
deliberately failed expecting 200 (58.3 s), before any production edit. The server list showed
exactly one new unique module ID matching the original key. An earlier probe counted duplicate
responsive/action links and was corrected to compare unique IDs; it is not the red evidence.
Sanitized diagnostics captured no client errors or failed script modules. Implementation started.

005 — STOPPED after two affected green-gate failures. The first used incomplete required-field
accessible names. The corrected case reached real exact replay HTTP 200 and retained local title
and route, then failed because the footer prioritizes generic dirty text over the confirmation.
An additional captured client TypeError comes from the existing unconditional `new URL(value)`
refinement in `externalLinkSchema` when an added resource's URL is empty. Reviewer independently
reproduced empty/malformed URL safeParse throwing TypeError; HTTPS remains accepted and HTTP
refused. The executor restored Worker types/cleaned scratch and stopped. Full gates, remaining
recovery variants and explicit PATCH verification are pending. Scope reconciliation follows.

005 reconciliation — resume only the affected desktop gate after correcting the existing status
priority and making the shared URL refinement return validation errors for invalid strings.
The latter is limited to contracts.ts/tests; accepted-link/security policy is preserved. Require
no captured client errors after the real resource-entry/recovery/PATCH flow. Both newly scoped
files still match foundation; expected partial changes remain six existing files plus three new
helper/access files. Initial manifests/red evidence are preserved. No new workflow or cloud action.

005 reconciled affected desktop gate passed (approximately 1.1 minutes): actual exact replay 200,
retained text/route, visible creation confirmation, explicit PATCH 200, stable context/lesson/link
IDs and UTC values, one module and zero captured client/script errors. The same case is being
extended with a later invalid URL to prove replay bypasses current validation and the following
invalid explicit save emits no PATCH. Remaining recovery variants and final gates still pending.

005 extended affected desktop gate passed (approximately 1.0 minute): replay 200 with a later
empty URL, retained invalid/local values, stored revision 1, zero PATCH from invalid explicit save,
then one valid explicit PATCH with stable IDs/UTC and one module. Reverting to the saved baseline
removes unsaved feedback. Client/script diagnostics are clean. The editor's dirty fingerprint
now canonicalizes object keys and omits only UI-only private-reference keys; editable array order
and persistent identities remain. Other variants/both viewports/full verification still pending.

005 targeted desktop gate passed all four creation cases: unchanged retry navigates to the
original revision-1 module; stale replay remains 409 through recovery GET 503/404/200 without
changing the command or automatically PATCHing; explicit reload/discard adopts the saved version.
Pending navigation preserves an invalid current title and identity. After recovery on `/nouveau`,
a later PATCH conflict and failed reload retain text until successful explicit reload. Stable
IDs/UTC, one new module and zero client/script diagnostics are asserted. Mobile and full gates
remain pending.

005 targeted creation gate passed 8/8 desktop/mobile cases in 8.4 minutes. The mobile full case
also proves exact replay 200 with the current URL empty, invalid validation without PATCH,
explicit valid PATCH preserving context/lesson/resource IDs and UTC, and later conflict/reload
failure retaining the draft until explicit successful reload. All captured page/script diagnostics
are empty. Final application gates and the complete 24-case browser replay are now running;
independent final review remains pending.

005 executor complete suite passed 24/24, with zero unexpected/flaky/skipped cases, in
1,415,955.963 ms (23 min 35.956 s; command wall 23 min 36.43 s). All other executor gates passed:
41 focused and 298 full unit tests, lint, application/browser types, clean autofixer and build.
Reviewer independently reran those non-browser gates successfully (Svelte zero diagnostics),
reviewed every scoped diff/new file and verified eight existing files plus three new files only.
Worker restored and scratch empty. Independent full browser replay has passed all twelve desktop
cases; mobile half remains pending. CI timeout remains 30 minutes; remote Ubuntu was not measured.

005 — APPROVED after independent full diff/scope review, 41 focused tests, full unit suite,
lint, application/browser types, clean Svelte autofixer and Workers build, all exit 0. The
independent second complete browser replay passed 24/24 in approximately 23.7 minutes. Original
server creation/replay policy is unchanged; exact uncertain commands persist only in editor
memory, later invalid/local edits remain, and only explicit saves/reloads write or replace them.
Recovery GET is teacher-only, strict and private/no-store/noindex. Malformed URL input now fails
validation without throwing; HTTPS/no-credentials rules are preserved. Final manifest hashes
match all eleven scoped files; Worker initial hash, empty scratch and original 416-file source
foundation verified unchanged. No commits, merge, deployment, real records or cloud migrations.

006 — Dispatched sequentially after 005 approval. Preserve rolling eight-hour/hourly renewal,
teacher passkeys, cookie attributes and public-reader bypass. Reviewed auth-test quota changes
from 002 and browser harness changes from 004/005 are expected baseline differences. Tests must
use only fictional session timestamp/revocation operations over private IPC, without returning
credentials. New session/cookie assertions and a complete final browser replay remain pending.

006 initial gates passed 32 targeted tests after the regression first failed against the old hook
for missing cookie propagation/returnHeaders. Real auth proves unchanged pre-updateAge behavior,
same-session eight-hour renewal and expired/revoked deletion. Reviewer inspected the minimal hook
diff, real auth tests, cookie-codec/request-isolation tests and public bypass assertions; existing
guards/configuration remain. Reviewer requested exact attribute checking for Secure, since a
substring alone can match the cookie name. Fictional IPC/browser coverage and full gates follow.

006 — STOPPED at raw cookie equality in both viewports. Earlier assertions verified the same
session/user, one row and advanced DB expiry; later browser expiry/deletion checks and full gates
were not reached and are not counted as passed. Reviewer inspected installed Better Call 1.4.0
sign/parse and Kit/cookie 2.0.1 serialization, then independently reproduced with synthetic data:
rawEqual false, decodedEqual true and authParserEqual true. Scope remains five existing files plus
one new hook test, Worker initial and scratch empty. Reconciliation changes only test credential
comparison to decoded semantic equality, retains all identity/expiry checks, adds the requested
private/no-store assertion, and requires the affected desktop gate before resuming mobile/full
gates. No production encoding or lifetime change is justified.

006 reconciled browser gates passed desktop (59.8 s) then mobile (59.5 s). Same decoded
credential/session/user and one row are retained; both expirations advance, immediate reads do
not renew, private data is no-store without credentials, and expiration/revocation remove the
cookie and require sign-in. HTTPS Secure is tested as an exact attribute, separately from
development loopback. Reviewer completed all five existing diffs and the new hook-test review,
including private IPC metadata and installed cookie codec. Full gates and complete 26-case
browser suite follow; independent final verification remains pending.

006 executor final non-browser gates passed: 32 focused tests, 309 full unit tests, lint,
application check (zero errors/warnings), browser types and Workers build. A test-only TypeScript
callback error was corrected with an explicit header wrapper before the clean final check;
production behavior and assertions are unchanged. Worker initial hash and empty scratch restored.
The complete 26-case suite has passed its desktop auth/boundary/renewal cases; remaining full
suite results, final manifest and independent replay are pending.

006 executor complete suite passed 26/26 with zero unexpected/flaky/skipped cases, report
duration 1,527,009.735 ms (command wall 25 min 27.47 s). Five existing source/test files and one
new hook test match the final manifest; unchanged fixture/process wrappers are verified.
Reviewer independently reran 32 focused tests, full unit tests, lint, application/browser types
and Workers build, all exit 0 with zero Svelte diagnostics. Worker was restored after review
generation and scratch is empty. Second complete browser replay is next. CI remains 30 minutes;
remote workflow duration including install/smoke is unmeasured, not represented as passed.

006 — APPROVED after independent full scope/diff review, 32 focused tests, full unit suite,
lint, application/browser types and Workers build, all exit 0 with zero Svelte diagnostics.
The second complete browser replay independently passed 26/26 in approximately 25.3 minutes.
Same-session rolling eight-hour/hourly renewal now reaches the browser through request-local Kit
cookie parsing/setting; attributes, deletion and decoded credentials are preserved. Public/error
readers and auth endpoint bypass remain unchanged. Before-updateAge, expired/revoked, encoded
values, multi-cookie handling, private/no-store and absence of serialized credentials are covered.
All six final hashes match; exactly five existing files plus one new test changed, no unexpected
new source files, Worker initial hash restored, scratch empty and no tracked browser/DB/PDF
artifacts. Execution HEAD remains e0adfff; original 416-file foundation unchanged.

All six authorized plans are complete and independently reviewed in the isolated checkout.
No automatic commit, merge, deployment, cloud migration or real-record operation was performed.
Migration 0007 is generated offline; production acceptance and operational actions remain separate.
The privacy decision register remains six PENDING decisions with readyForRealStudentData false:
technical success does not verify legal basis, institutional role, notices/rights, retention,
provider contracts/transfers, AI/DPIA classification or deployed HTTPS acceptance. Remote GitHub
Actions, physical devices and VoiceOver were not tested. Existing PDF chunk-size warnings and
the unselected activation-body bound remain documented follow-up work.
