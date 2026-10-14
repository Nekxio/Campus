# Plan 005: Recover a committed module without losing edits after a lost creation response

> Run all gates and preserve the original creation identity while its outcome is unknown.
> First run `git diff --stat e0adfff..HEAD -- src/lib/components/teaching/ModuleDraftEditor.svelte src/lib/teaching/api.ts src/lib/domain/teaching.ts src/routes/api/teaching/modules src/lib/server/teaching/service.test.ts` and compare `plans/baseline.json`.
> New browser files from completed plan 004 are expected; compare their final recorded state.

## Status

- Priority: P1
- Effort: M
- Risk: MED; preserve later edits, revisions and duplicate protection
- Depends on: `plans/004-repeatable-browser-tests.md`
- Category: bug
- Planned at: commit `e0adfff`, 2026-10-13, including uncommitted source
- Audit finding: 4

Execution reconciliation, 2026-10-14: the required red test proved actual edited-retry 409 on
the unchanged editor. A later corrected desktop case reached exact replay 200 and retained local
title/route, but confirmation was hidden by the existing footer's dirty-first branch. Two green
attempts stopped; do not repeat blindly. Independent reviewer inspection attributes this failure
to the status template. Diagnostics also identified `externalLinkSchema` throwing TypeError for
empty/malformed URLs; reviewer reproduced both through the real schema. That shared guard affects
new-resource entry and recognition of later invalid drafts, so the narrowly scoped guard/tests
below are necessary to complete recovery. HTTPS/no-credentials policy and public projection
semantics remain the same. Existing partial 005 changes are expected drift, not a fresh baseline.

## Why this matters

Creation can commit successfully while its response is lost. The editor stays on `/nouveau` and
reuses the creation ID, but rebuilds the payload after every edit. Its next save then gets 409
because the server correctly refuses different content under that identity. The offered refresh
always reloads a route whose module is null, so it cannot recover and nevertheless announces
success. Resolve the original command and keep later edits available for an explicit update.

## Current state

`src/lib/components/teaching/ModuleDraftEditor.svelte:345`:

```ts
const payload = moduleDraftSchema.parse(toDomain(validated.data));
const creating = moduleId === null;
const saved = creating
	? await saveTeaching<ModuleDetail>(
			'/api/teaching/modules',
			payload,
			'POST',
			(creationId ??= crypto.randomUUID())
		)
	: await saveTeaching<ModuleDetail>(/* PATCH with expectedRevision */);
applySaved(saved);
```

At lines 412–414 the reload calls `refreshAll()`, applies data only if `data.module` exists,
and always reports reloaded. `src/routes/enseignant/modules/nouveau/+page.server.ts` explicitly
returns `module: null`. `applySaved` sets identity/revision/date metadata then resets the form.

`src/lib/server/teaching/service.ts:448` only replays an existing creation if revision is 1 and
`creationFingerprint(editableModule(saved))` matches the submitted draft. Do not weaken that rule.
The existing `/api/teaching/modules/[moduleId]` route exports PATCH only. `getModule` already returns
an explicit private draft projection, including context IDs/revisions but no roster/corrections.

`src/lib/teaching/api.ts` turns network/JSON failures into `TeachingRequestError` and preserves
form contents. Module/context revisions are validated transactionally. Teaching forms use one
typed Superforms store, Zod 4 and Formsnap. Existing parent `ModuleEditor.svelte` keys the editor
by module ID or `new-module`; an unnoticed remount can discard the pending command.

## Commands you will need

| Purpose                            | Command                                                                                                                                               | Expected                                                  |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Targeted unit/service/access tests | `pnpm test:unit --run src/lib/teaching/module-creation.test.ts src/lib/server/teaching/module-access.test.ts src/lib/server/teaching/service.test.ts` | All pass                                                  |
| Shared URL regression              | `pnpm test:unit --run src/lib/domain/contracts.test.ts`                                                                                               | Invalid input returns validation failure without throwing |
| Browser regression                 | `pnpm test:browser --grep 'module creation'`                                                                                                          | Desktop/mobile pass                                       |
| Svelte analysis                    | `pnpm ai:svelte svelte-autofixer src/lib/components/teaching/ModuleDraftEditor.svelte`                                                                | No remaining issues                                       |
| Full gates                         | `pnpm lint`, `pnpm check`, `pnpm check:browser`, `pnpm test`, `pnpm test:browser`, `pnpm build`                                                       | Exit 0                                                    |

Use Node 26/pnpm 12, explicit-file formatting, `.js` imports and current installed types. Read
the repository Svelte code-writer/core-bestpractices skills, list sections then get relevant
navigation/state documentation before editing. Preserve the Superforms Kit 3 bridge.

## Scope

In scope:

- `src/lib/components/teaching/ModuleDraftEditor.svelte`
- `src/lib/teaching/module-creation.ts` and `.test.ts` (new pure retry-state helper)
- `src/lib/teaching/api.ts`, only backwards-compatible error metadata distinguishing a decoded
  server failure from a network/JSON-decoding failure; preserve existing callers and behavior
- `src/lib/domain/teaching.ts`, only a strict private module-detail response schema
- `src/lib/domain/contracts.ts`, only make the existing externalLinkSchema refinement total for
  malformed/empty strings while preserving HTTPS/no-credentials policy and error copy
- `src/lib/domain/contracts.test.ts`, nonthrowing invalid URL regressions and policy preservation
- `src/routes/api/teaching/modules/[moduleId]/+server.ts`, GET read only
- `src/lib/server/teaching/module-access.test.ts` (new)
- `src/lib/server/teaching/service.test.ts`, regression assertions only
- `tests/browser/drafts.spec.ts`, using the harness from plan 004
- This plan's index row

Out of scope: `createModule` replay policy, migrations, MCP binding/receipts, automatic saves,
global/localStorage/IndexedDB draft persistence, class creation and redesign/new screens.
Do not create an alternative public draft-read endpoint.

## Git workflow

Preserve existing work; GitButler mutations only when requested, after `but status`. No automatic
commit/push/merge or snapshot application. Dispatched execution uses an isolated checkout.
Code style is tabs, single quotes, no trailing commas, width 100; Form components use `#lib` barrels.

## Steps

### Diagnostic resumption after the stopped green gate

Retain the original 005 manifest and the red/failed-green evidence. Capture additional neutral
snapshots of the two newly scoped contract files before changing them; their current hashes must
match the original foundation. First fix the existing status affordance so creation-confirmed
and edits-unsaved is visible while dirty. Preserve generic unsaved feedback after normal saved
modules are edited again, and do not claim unsaved edits after they are reverted to the baseline.
Use the current aria-live role/status area; no new component or user action is needed.

Make externalLinkSchema reject malformed/empty strings through Zod validation instead of throwing
from new URL. Catch only URL construction failure or otherwise guard that construction; keep
accepted HTTPS links and refusal of HTTP, executable schemes and credentials unchanged. Add
real schema tests for empty, whitespace-only, malformed and incomplete URL inputs, including
through moduleDraftSchema; sameModuleDraft must regard later invalid URL input as changed without
throwing. Do not broaden acceptance, coerce relative URLs or change the other contracts.

Extend the affected existing browser case to assert zero sanitized page errors/failed modules
after resource entry and actual recovery/PATCH. Run this desktop case first with the same bounded
timeouts; only after it passes resume both viewports, remaining variants and full gates below.
If it fails again, STOP with its exact phase and evidence before another change.

### Step 1: Capture the exact command and reproduce a committed lost response

Add a pure helper whose pending state contains immutable creation ID and domain payload.
Snapshots use `structuredClone`; keep them instance-local and never persist preparation in browser
storage. A new form submission while outcome is unknown replays that exact command first, even
if the current form differs. Explicit pre-write 400/413/415/422 validation failures may clear
the pending command; network failures, undecodable responses, 503 and 409 must not allocate a
replacement identity automatically.

Execution refinement, 2026-10-14: `saveTeaching` currently gives a JSON-decoding failure the
HTTP status it received, so status alone cannot identify a definitive pre-write rejection.
Add minimal typed error metadata in `TeachingRequestError` and its existing request adapter:
only a decoded server error envelope can qualify for the explicit pre-write statuses above.
Network failures, invalid/undecodable envelopes and malformed success projections retain the
pending command even if the HTTP status is 400/413/415/422. Preserve the public constructor's
existing arguments and all other callers' draft/error behavior. Test this distinction through
the actual adapter with mocked transport responses in the new helper test file, not merely a
status-list copy. This is an in-scope local reliability refinement, with no new user workflow.
Validate successful creation/recovery projections against the strict response schema and the
known requested module ID before resolving the command. A well-shaped response for another ID
is an unknown outcome, not proof that this creation completed; retain the original command.

In the browser test, intercept the first creation POST, call `route.fetch()` so the actual write
commits, then abort delivery. Assert exactly one module was created by its original ID. Edit the
title/preparation locally and press save again. Before the fix, the current source must reproduce
the 409/reload dead end. Store captured request bodies only in test memory.

Verify: helper unit tests pass; the new browser regression must fail for the known recovery
behavior before implementation. Do not mark it skipped or mock the initial database write.

### Step 2: Add the protected read needed for recovery

Add GET to the existing private module route. Check `requireTeacher` before ID validation or DB
access; use `withTeacherDatabase` and a transaction around `getModule`. Return the strict
module-detail projection with private/no-store and noindex headers for success/errors. Preserve
PATCH unchanged. Add the response schema with `moduleDraftSchema.safeExtend` plus UUID/revision
fields; avoid broad record spreading or accidental roster inclusion. Authorization follows this
single-teacher application's existing pattern; do not invent multi-tenant architecture.

Verify: module-access tests assert anonymous malformed IDs are 401 before DB access, malformed
authenticated IDs/missing modules are 404, success is private/no-store, and response fields match
the draft allowlist. Existing service tests still refuse different content under the same ID.

### Step 3: Resolve creation without overwriting newer local edits

On replay success, record the saved module ID/revision/date metadata and saved baseline. If the
editable form still matches the sent draft, normal `applySaved` and navigation are valid. If it
contains later edits, keep its editable values and route instance, update only server baselines
and context revisions for the retained stable IDs, and report through existing status text that
creation is confirmed and current edits still need saving. Do not automatically PATCH them.
The next explicit save updates the recovered ID with the current optimistic revision.

If identical replay returns 409 because another window changed the committed module, fetch the
known ID. Retain the editable draft and show the existing conflict state; applying fetched data
must use the current explicit reload/discard confirmation. A 404 read alone is not proof the
original POST cannot still commit: retain and replay the original identity, never mint another.
Reload on `/nouveau` must target the known pending or already recovered module ID when present,
including after the pending command was cleared while later edits kept that route instance.
Announce success only after actual recovery/application. Avoid navigation/remount until drafts
are safely preserved or the teacher explicitly confirms discard.

Verify: unit and browser cases show one module, unchanged later local text after recovery,
explicit PATCH persistence, and genuine stale-window conflicts retaining the draft.

### Step 4: Verify boundaries and existing editing workflows

Cover recovery GET failure, 404, changed stored revision, unchanged exact replay, clear pre-write
validation failure and discarded drafts. Dates displayed unchanged must keep their saved UTC
instants; new context/lesson/link IDs remain stable. Keep pending controls/dirty navigation guards.
Use current Alert/status/reload affordances and French copy; no new visual workflow is required.
If new screens/actions are needed, stop for Impeccable alternatives and Léo's design choice.

Verify: Svelte autofixer clean, format explicit files, then all gates in the command table pass.
Review the private route and response projection for access controls and serialization.

## Test plan

Pure cases: immutable command replay, changed editable payload, definitive pre-write rejection,
unknown outcome and successful identity resolution. Browser cases: committed/lost first response
plus edits; unchanged retry; stale server revision; reload failure; and pending navigation.
Exercise reload after a later PATCH conflict on `/nouveau` with a recovered ID and no pending
command; the route's null server data must not cause a false successful reload.
Read-access tests use `src/lib/server/teaching/http.test.ts` and export-access tests as patterns.
No test replaces the real server idempotency mechanism with its own copy.

## Privacy and French/EU requirements

Keep draft data and retry bodies in request/component-local memory only; no persistent diagnostic
copies or credential logs. Recovery reads remain teacher-only and contain no student results.
RGPD Articles 5/25/32 require minimization and protection against loss or unauthorized access;
see [CNIL principles](https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre2).
Fictional data only. The operator's individual use does not authorize adding student names to
public material or sending them to new services.

## Done criteria

- [x] Lost-response creation followed by edited retry leaves exactly one saved module.
- [x] Later edits remain visible/dirty and save only through explicit PATCH.
- [x] Genuine revision conflicts, read failures and 404 preserve the draft and original identity.
- [x] Reload no longer announces recovery when no module was recovered.
- [x] GET is authenticated before private reads and returns only the draft projection.
- [x] Autofixer, browser/unit tests, lint, types and Workers build pass; scope/index reviewed.

## STOP conditions

Stop on unexplained drift, repeated failures, a required schema/receipt change, unavoidable
automatic overwrite, or recovery requiring a new visual workflow. If context revisions cannot
be reconciled without changing the meaning of retained calendar edits, retain the conflict and
report the ambiguous IDs rather than guessing. Never remove server duplicate-content checks.

## Maintenance notes

Additional creation forms should retain both identity and immutable command, not only a retry key.
Adding browser draft persistence later requires a separate privacy/security decision. Keep the
recovery test at the actual client/server boundary, including commit followed by response loss.
