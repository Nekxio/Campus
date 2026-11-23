# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Léo is the primary user: a teacher preparing modules, publishing course material and recording
grades, mainly from his Mac. Students need a clear place to find the materials for their class
and module, including when they miss a lesson. The school's pedagogy team receives a complete final module grade-grid PDF; it has no app account.

## Product Purpose

Campus centralizes teaching preparation, student-facing material and grading without the
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

## Current approved scope

One teaching organization and one teacher account per deployment; Léo is the sole production teacher. Invitations can create the initial account or recover that same account without changing its identity, but cannot add a second teacher. A module belongs to one class; reuse for another class makes an independent copy without students, scores, planning or deadlines. Public material includes selected links, module/project instructions, blank criteria and ungraded exercises with freely accessible corrections. No student accounts, file storage or date locks. Native graded quizzes are included; their contract is described below and in [GLOSSARY.md](GLOSSARY.md).

Quiz sections normalize each native or external Wayground quiz score and average quizzes equally. Sections and independent results are configurable. Numerical rubric changes retain raw points and mark affected corrections for review. Projects lose one point per Paris calendar day for 1–5 days; beyond five days they are zero, with explicit exceptions and a zero floor.

Native quizzes are graded classroom examinations, with manual room opening/start/closure, a global timer, exact-set scoring, saved answers, reconnect and teacher-approved absence retakes. The teacher can open and start a reviewed quiz on any day, before or after its associated lesson date, provided its course is published and the other room eligibility checks pass; the planned lesson date is unchanged. A closed room also offers a separate first sitting for selected newcomers who have neither a mark nor a previous cohort for that quiz. Eligibility is checked per quiz scoring line at opening and first start; prior marks, including earned or manual zeroes, remain protected. Students choose a roster name without creating an account. Fullscreen and focus incidents inform the teacher; browsers cannot lock operating-system navigation or prevent screenshots. The final correction is available only in the live final screen after closure, for a single 15-minute consultation. At expiry, the browser clears the private quiz data and replaces the quiz page with the module URL without requiring a network response; loading the module itself still requires connectivity. Sleep and background time count toward the limit. No practice mode, in-app AI authoring feature or permanent student correction history is included. The approved interface uses a wide workspace with contextual detail drawers.

Class PDFs cover every student in the selected class regardless of search/filters, with section marks/weights and all defined final results. Individual PDFs contain one student's complete rubric, section subtotals and contributions, without the module description. Neither includes comments. Missing, incomplete or invalid required results block a final export; there is no provisional final PDF or invented annual average.

Annual close is manual with a reviewed per-module continue/pause choice. It deletes the selected annual student records in Campus, including associated private quiz-room data, while preserving every module and external Drive/PDF files. Continued module/class public URLs stay stable through distinct annual contexts; paused modules become private until explicit resumption and publication, and uncontinued classes lose their directory. Archived contexts can be unpublished but cannot be republished. Annual SQL deletion and a durable list of quiz rooms to clean are committed together before external room deletion. A failed cleanup remains resumable by the identical decision command or the authenticated annual-page reload; successful completion is acknowledged only after every room confirms deletion. Module imports remain drafts, preserve omitted content and name removals explicitly.

Daily teacher class choices use the current academic year in Europe/Paris, changing on September 1.
Creating a class in the web interface assigns that year automatically. Previous or future cohorts
never replace an empty current year. Annual management retains explicit year selection, historical
reading and final PDF access; calendar rollover neither closes nor deletes records. Existing module
contexts remain part of their saved baseline, even when they are absent from daily class choices.
Explicit historical publication access remains available for withdrawal. External agent contracts
and annual continuation retain their explicit year identities.
Existing calendar associations keep their identities and historical labels; only new association
choices are restricted to the current year. Reusable modules and pending correction proposals retain
their annual context when it is needed to identify existing work.

This document defines the approved teaching rules. [README.md](README.md) covers their workflows and operating boundaries; [MCP-COVERAGE.md](MCP-COVERAGE.md) defines the remote agent capabilities.

## Capabilities and Constraints

The repository implements teacher access, account and connected-application management, annual
classes and roster imports, reusable module preparation, rubrics, grading, private correction
proposals, publication review, public class/module reading, final PDF export and annual history
and closure. Native graded quizzes, remote MCP authorization and a school calendar subscription
extend the original teaching workflow. Local implementation does not establish current production
availability or complete acceptance.

A module retains teaching content, preparation, resources and assessment definitions. A teaching
context binds its delivery to a class and academic year. Annual rosters are shared across that
class's modules. Use [GLOSSARY.md](GLOSSARY.md) for the domain vocabulary.

Teacher access uses invitation-only Better Auth passkeys. Students have no accounts: published
class/module pages are public by link and contain only selected course material, never names,
individual grades or private comments. Sources stay local and selected student exports stay on
the existing professional Drive; Campus stores links only. Replacing an already shared Drive
file is immediately visible independently of Campus page publication.

Teachers can attach instructions and selected resource links to a dossier through its assessment
identity. The public dossier brings these together with its own blank rubric and annual deadline.
Workshops can belong to a semester, refer to the module's resources and be assigned to a lesson
in the current teaching context. Only a workshop with a written correction or correction code
offers the correction view. Existing publications remain readable without these associations.
Archiving a native quiz retains its teacher history and grades and removes it from student room
discovery. The next reviewed publication excludes its grading line. Available quizzes follow
the chronological order of their scheduled lessons.

Modules and their preparation, materials, rubrics and calendar history are reusable and durable.
Annual classes and student identities, corrections, submissions, proposals and comments can be
purged. Points are whole numbers; calculations retain full precision and /20 results display one
decimal. Raw points survive changed maxima; excess points are flagged without clamping, and removed
lines/assessments retain their history outside active calculations. New lines remain pending and a
missing score never means zero. The four assessment states separate pending work, graded work,
unjustified absence at zero and justified absence awaiting a decision. Absence disables entry without
erasing points. Group and assessment maxima derive from scoring lines; result rules support weighted
components or raw-point aggregation with independent /20 outputs and formative exclusions. The
15/25/60 fixture is not a global formula. Project delay uses Paris calendar days with explicit
exemptions/refusals; refusal resolves the project to zero. Manual saves, draft retention and revision conflicts protect private
corrections and the separately saved, copyable semester comment. Local agent corrections use proposals requiring explicit review; they do not overwrite recorded results automatically. Remote OAuth clients can use separately delegated grading and decision rights through the same checked services. The first version does not add a support editor, AI chat or a backup/restore UI.

### Agent assistance

The local stdio MCP uses explicitly selected source folders, durable folder bindings and scoped,
expiring teacher-bound keys. `examples/mcp-module/` provides the tracked fictional source example;
copy it into a local working folder as described in [README.md](README.md#local-module-mcp).
Local host configuration must
select exact folders rather than the whole teaching-document tree. Sources are data, not instructions. The remote HTTP MCP uses browser OAuth
consent and revocable rights through **Applications connectées**. It cannot inspect the Mac or
manipulate local folder bindings. Neither transport gives agents Turso or Drive credentials.

Module patches preserve omitted content and name removals explicitly. Rubric replacement requires
explicit confirmation and preserves retained lines' raw points. Local corrections require separate
rights and produce private proposals anchored to current records; local keys cannot decide them.
The remote OAuth interface also supports explicitly delegated saved grading, proposal decisions,
publication, annual lifecycle, calendar and roster changes. Sensitive operations require their own
consented scopes and retain the application's identities, revisions, confirmations and retry receipts.
Point and comment decisions remain independent; draft imports never publish automatically.

Quiz draft tools require explicit quiz rights. Draft import tools mark content for review; the remote
review tool can save reviewed content with its additional scope. Room opening, retakes and lifecycle
commands remain manual teacher actions in the interface, outside MCP. See
[MCP-COVERAGE.md](MCP-COVERAGE.md) for the precise remote authorization boundary and
[README.md](README.md#local-module-mcp) for local imports and proposals.

### School calendar

The teacher can preview a private Pronote Campus iCalendar subscription and explicitly associate
selected source courses with existing module/class/year contexts. Preview alone imports nothing.
Imported titles and times are source-owned; teacher preparation remains editable. Manual lessons
stay independent unless explicitly adopted. Conflicts and unsupported feeds fail closed.

Refreshes run on authenticated teacher usage, at most once automatically per Paris usage day, with
explicit retries available. There is no cron and public pages never fetch the feed. Failures keep
the last good lessons. Disconnecting stops refreshes and retains lessons. Calendar changes
invalidate stale forms and publication reviews without changing published snapshots automatically.
Real-feed compatibility and production capacity require deployment-specific acceptance.

### Technical and delivery boundaries

The existing SvelteKit/Svelte, TypeScript and shadcn-svelte application runs on Cloudflare Workers
with Turso/libSQL. Ordinary validation uses isolated fictional data. Cloudflare and Turso must remain
viable on free plans; this constraint does not establish that real usage fits their quotas.
There is no file-upload/storage service, editable support-document copy, AI chat or backup/restore UI.

Real student data remains excluded until complete HTTPS acceptance. Cloud migrations, deployment,
real keys and broader source access require dedicated operator actions. The original backend snapshot
remains preserved on unapplied `wip/database-auth`; it must not be overlaid on the active workspace.

## Brand Commitments

The product name is Campus. No bespoke logo, marketing claims or additional brand identity has
been approved. [DESIGN.md](DESIGN.md) records the incumbent visual system and approved compositions.
Each new page or visual workflow requires an Impeccable brief, layout alternatives and Léo's explicit
design choice before implementation, including access-management screens.

## Validation boundaries

Repository implementation and local tests do not establish current production health, migration
state or complete acceptance. Verify the intended HTTPS deployment, passkeys and MCP, actual calendar
feed, Worker capacity, screen readers, physical devices and Safari/iPhone workflows separately.
Migration state belongs to the selected database's current journal, not an implementation report.
See [README.md](README.md#acceptance-boundaries) for the validation boundary.

## Product Principles

- Keep daily preparation and grading easy to find and easy to edit.
- Publish deliberately after review, with clear separation between audiences.
- Reuse existing material instead of maintaining copies.
- Add student-facing detail only when it helps students follow the course.

## Accessibility & Inclusion

Responsive desktop and mobile web; target WCAG 2.2 AA as required by the project guidelines.
Preserve keyboard access, clear labels, readable content and reduced-motion preferences.
