# Annual archive and purge

The teacher opens **Classes → Fin d’année** and deliberately selects a year. The approved
`year-continuous` composition keeps a single dossier: final PDFs by module/class, records that
purge removes, durable records it keeps, then separate archive and purge actions. No current year
is preselected. This page requires the existing teacher session; MCP cannot archive or purge.

## Archive and reopen

**Archiver sans supprimer** removes the year's classes and contexts from active preparation,
grading and agent import choices. Student records remain stored. Archived results, raw criterion
points, comments, calendars and deadlines are available through **Consulter l’historique** in the
dossier. Eligible complete PDFs remain exportable, using the same current rubric/calculation rules
as Notation. Archive does not freeze a separate rubric copy. Shared module content and rubrics
remain reusable. **Rouvrir l’année** restores work explicitly until the year has been purged.
A year lifecycle record also protects a class that has no module.

## Purge

**Préparer la purge** opens a Formsnap/Superforms/Zod confirmation showing the selected year,
class names and exact counts. The teacher must type that exact year and acknowledge keeping the
necessary PDFs. Export availability does not imply that a file was saved. A formative-only module
or an incomplete export is reported, without requiring every context to have a final grade.

The transaction archives retained contexts, deletes selected-year classes, students, corrections,
criterion-score records, submissions/lateness decisions, private comments, correction proposals
and proposal-decision receipts. It retains modules, objectives, preparation, source references,
selected links, rubrics, class/year labels on contexts, lessons, deadlines, publication snapshots
and teacher/passkey/agent access. Published module links survive; deleted class directories do not.
No local or Drive file is removed. The selected year cannot be reopened or accidentally recreated
after purge. New-year classes reuse modules with empty rosters/results and explicit new dates.

Retained context history stays reachable from the dossier after purge. It contains calendars and
preparation, with no student roster or results. PDFs already downloaded are external archives;
they cannot restore criterion-level data or be regenerated after student records are removed.

## Consistency, access and retries

Private reads and writes authorize the teacher before parsing inputs/reading data. Mutations also
require the same Origin, strict input validation and a reviewed snapshot token. The snapshot covers
classes/roster, correction bodies and points, comments/proposals/decisions, module/rubric/resources,
calendars/deadlines and publications. Same-count changes invalidate it. A mismatched legacy
class/year association fails closed. HTTP 409 requires explicit refresh and a new confirmation.
Class, context and module revisions advance on lifecycle changes to invalidate stale editors and
MCP imports. Existing shared-module updates keep their normal revision checks.

A request UUID and input hash are stored with the decision in the same transaction. An identical
retry returns the original receipt before checking the new state; a different body using that UUID
is rejected. Receipts keep only teacher/request identity, year, action, timestamp and counts, never
student names or private text. Client forms retain the exact sent command while a response is
unknown. A failed transaction rolls back deletion, detachment and the receipt together.
Responses are private/no-store and noindex. No new account, upload, backup or cloud permission is added.

## Schema and validation

`drizzle/0006_chunky_dakota_north.sql` adds `academic_year_lifecycle` and `annual_receipt`.
It is generated offline and unapplied to Turso. Migrations and HTTPS deployment remain explicit
operator actions. Local tests use disposable in-memory SQLite; browser acceptance uses an isolated
loopback-only fictional copy, with no authentication seam in production source.

Targeted tests cover archive/reopen, zero-module classes, read-only/PDF access, stale writes and
same-count changes, exact confirmation, year isolation, private-record cascades, preserved published
modules, lost-response retries, altered-key rejection and full rollback. Browser validation covers
Formsnap errors and labels, year switching, history/PDF, archive/reopen and the protected purge flow,
plus light/dark desktop and mobile layouts. Real-device and screen-reader checks remain separate.
