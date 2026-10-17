# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Léo is the primary user: a teacher preparing modules, publishing course material and recording
grades, mainly from his Mac. Students need a clear place to find the materials for their class
and module, including when they miss a lesson. The school's pedagogy team receives a complete final module grade-grid PDF; it has no app account.

## Product Purpose

Coursely centralizes teaching preparation, student-facing material and grading without the
duplicate pages, repeated edits and publication mistakes experienced with the previous Notion
workspace. The teacher must be able to edit it comfortably by hand as well as with AI assistance.

## Operating Context

- Start with a new hub; historical Notion data is outside the current migration scope.
- A compact teacher home connects module preparation, the next intervention, ready-to-publish
  material and grading. Link to existing sources instead of duplicating them.
- A student class page lists modules. Each module has course materials, instructions and rubrics,
  deadlines and submission details, useful resources, and an optional short lesson recap/to-do.
- Grade grids contain students and calculated assessment/module results, including independent
  results when required by the module. The school receives the complete final PDF once all
  required results are resolved; detailed criterion lines and comments remain private.
- Keep a private end-of-semester comment for each student and module, ready to review and copy
  into the school's existing form.
- Use up to 12 students per class as the planning range supplied by Léo, not a product limit.

## Current approved scope — 15 October 2026

MyDigitalSchool only. A module belongs to one class; reuse for another class makes an independent copy without students, scores, planning or deadlines. Public material includes selected links, module/project instructions, blank criteria and ungraded exercises with freely accessible corrections. No student accounts, file storage, quiz engine or date locks.

Quiz sections normalize each Wayground quiz score and average quizzes equally. Sections and independent results are configurable. Numerical rubric changes retain raw points and mark affected corrections for review. Projects lose one point per Paris calendar day for 1–5 days; beyond five days they are zero, with explicit exceptions and a zero floor.

Class PDFs contain section marks/weights and all final results; individual PDFs contain one student’s complete rubric, section subtotals and contributions. Neither includes comments. Incomplete required results block a final export.

Annual close is manual with a reviewed per-module continue/pause choice. It deletes the selected annual student records in Coursely while preserving every module and external Drive/PDF files. Continued public URLs stay stable through distinct annual contexts; paused modules become private. MCP changes remain drafts, preserve omitted content and name removals explicitly.

The implementation plan is `docs/plans/2026-10-15-teaching-workflows.md`. Older milestone accounts below remain historical.

## Capabilities and Constraints

The business integration plan was approved on 12 October 2026. The data and teacher-authentication
foundation is implemented and validated locally with isolated fictional fixtures. The approved sign-in and vertical invitation screens are implemented. Teacher home, annual
classes, roster imports and reusable module drafts now use private teaching services. Modules
include preparation, selected links and optional class calendars. Private rubric editing, grading
calculations, the class result grid and detailed correction are implemented with the approved
`rubric-table`, `grid-split` and `correction-bottom-summary` compositions. Teacher publication review and public class/module pages are implemented with the selected
`publish-sections` and `student-tabs` compositions. Final module PDF export is implemented; annual archive and purge are implemented locally with the approved `year-continuous` dossier; cloud/HTTPS acceptance remains pending. Local module creation/update via MCP is implemented
with scoped agent keys, durable folder bindings, atomic imports and revision/retry protection.
Imports reuse the existing editor. Correction proposals and their private review are implemented with the selected `proposal-inline-comparison` composition, independent point/comment decisions and explicit teacher acceptance. The module and grading migrations
`0001_lonely_gateway.sql`, `0002_brown_unus.sql` and agent migration
`0003_premium_tomas.sql` and proposal migration `0004_lyrical_skullbuster.sql`, plus publication migration
`0005_nasty_skrulls.sql` and annual lifecycle migration `0006_chunky_dakota_north.sql` were generated offline and remain unapplied to Turso. No real student data is
allowed before complete HTTPS acceptance testing.

Teacher access uses invitation-only Better Auth passkeys. Students have no accounts: published
class/module pages are public by link and contain only selected course material, never names,
individual grades or private comments. Sources stay local and selected student exports stay on
the existing professional Drive; Coursely stores links only. Replacing an already shared Drive
file is immediately visible independently of Coursely page publication.

Modules and their preparation, materials, rubrics and calendar history are reusable and durable.
Annual classes and student identities, corrections, submissions, proposals and comments can be
purged. Points are whole numbers; calculated results may have one decimal. Raw points survive
rubric changes and a missing score never means zero. The four assessment states separate pending
work, graded work, unjustified absence at zero and justified absence awaiting a decision. Independent
results and formative exclusions remain configurable; project delay uses Paris calendar days with
explicit exemptions/refusals. Manual saves, draft retention and revision conflicts protect private
corrections and the separately saved, copyable semester comment. Agent corrections use proposals requiring explicit teacher review; they do not overwrite recorded results automatically. The first version does not add a support editor, AI chat or a backup/restore UI.

Use the existing luma theme and shadcn-svelte shell. Each new page or visual workflow requires
an Impeccable brief, layout alternatives and Léo's choice before implementation, including the
sign-in and invitation screens. Cloudflare Workers and Turso must remain viable on free plans
without unnecessary service dependencies. The original backend snapshot remains preserved on
unapplied `wip/database-auth`.

## Brand Commitments

The product name is Coursely. Use the project's shadcn-svelte foundation. No bespoke logo,
marketing claims or additional brand identity has been approved.

## Evidence on Hand

The reopened original alternatives confirmed `student-tabs` (Un bloc à la fois) and `publish-sections`. The tabbed student page keeps one content panel visible and grounded deadline/project references available. Its fresh independent full supplied-surface Impeccable review returned `ship`; types, lint, 203 tests and build pass. The ordinary-extension documenter preserved the incumbent system. Evidence and thirteen native captures are in `.impeccable/review/lot5-student-tabs/`. Former student-document captures and verdicts remain historical. Physical-device, screen-reader,HTTPS and real Drive acceptance remain outstanding.

The publication/student-view part of lot 5 passes 203 tests across 27 files, types with zero
errors/warnings, formatting/lint and the Workers build. Twenty-one production-source local Workers
HTTP checks verify private guards and public fail-closed/no-store behavior without secrets. Fictional
browser checks cover snapshot stability, publish/unpublish/republication, stale-window review retention,
explicit refresh and public class/module reading. The initial full Impeccable review returned `ship`, but Léo rejected the design fidelity on
13 October 2026. That visual approval is superseded. A fresh full review returned `fix`; the original
The then-recorded `student-document` composition was later rejected again. On 13 October, Léo explicitly reconfirmed `student-tabs` and `publish-sections` from the original alternatives; those are now authoritative. Corrective evidence is in
`.impeccable/review/lot5-fidelity/`. After correction, the same reviewer returned `ship` on a verdict pass scoring all eight fixes resolved; this is not a second full surface review. Final types/lint/build and 203 tests pass. A fresh ordinary-extension documenter preserved DESIGN.md and its sidecar. Real Drive sharing/replacement, cloud activation,
HTTPS acceptance, real-device and screen-reader checks remain outstanding.

The completed correction-proposal part of lot 4 passes 174 tests across 23 files, with lint,
Svelte/application and operator-script types, and the Workers build. Actual stdio/HTTP tests cover
deposit/retry, explicit key scope and rejection of API-key decisions; migrated local tests cover
independent decisions, stale references, legacy proposals and annual cascades. An isolated
production-source Worker passes nine privacy checks. Fictional browser checks exercise integer
errors, absence, dirty navigation, independent comment drafts, acceptance, conflict and refusal.
The selected code-led review screen passed an independent supplied-surface Impeccable finish review;
the documenter preserves the incumbent system. Real key/migration/HTTPS activation remains pending.

The module-import part of lot 4 adds 34 checks for a total of 139 passing tests across 20 files.
Real stdio/local HTTP tests cover creation, updates, binding, retries, conflicts, scoped identities,
raw-score preservation and key revocation. The production-source local Workers preview refuses
anonymous agent access and public key management. The registered MCP is limited to an isolated
fictional module folder; real database/key activation remains pending. No new screen was added.

The repository contains the SvelteKit/shadcn-svelte teacher workspace, Formsnap/Superforms/Zod
forms and the approved business plan. Latest lot 3 local validation passes 105 tests across 16 files,
Svelte/application and operator-script types, formatting/lint and the Workers build. Fictional local
fixtures cover complete/incomplete grades, absences, delays, rubric history and independent results.
Browser checks cover integer input, absence transitions, dirty navigation, saved reloads and
second-window HTTP 409 draft retention. Production-source local Workers smoke keeps grading pages
and comment writes private.

Rubric, grid and correction proof captures cover desktop, mobile and the requested 810px width;
correction supplements cover dark mode, history/auxiliary states and a long group at the keyboard.
The fresh Impeccable review used the degraded role contract. Its final `ship` verdict resolves two
correction findings after two fix batches; it does not claim a second full review or an independent
server/calculation audit. Evidence and limitations are recorded in `.impeccable/review/lot3/` and the
README. Real-device, screen-reader and full HTTPS passkey acceptance remain outstanding.
The earlier prototype and full saved workspace remain preserved; historical Notion data is outside
migration scope.

## Product Principles

- Keep daily preparation and grading easy to find and easy to edit.
- Publish deliberately after review, with clear separation between audiences.
- Reuse existing material instead of maintaining copies.
- Add student-facing detail only when it helps students follow the course.

## Accessibility & Inclusion

Responsive desktop and mobile web; target WCAG 2.2 AA as required by the project guidelines.
Preserve keyboard access, clear labels, readable content and reduced-motion preferences.
