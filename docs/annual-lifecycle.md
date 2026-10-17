# Manual annual archive and closure

The teacher opens **Classes → Fin d’année** and deliberately selects a year. `year-continuous`
keeps one dossier: final PDFs, annual records that will be removed, durable teaching material retained,
then the actions. No year is implicitly selected. There is no automatic closing date, minimum retention
period enforced by the app or scheduled purge. These operations require a teacher session, never MCP.

## Archive and reopen

**Archiver sans supprimer** removes the year's classes and contexts from active preparation, grading
and agent choices. Student records remain available read-only through **Consulter l’historique**;
eligible final PDFs remain downloadable. Archive does not freeze a rubric copy. **Rouvrir l’année**
restores work explicitly until closure has removed the annual records. A year lifecycle record also
protects a class with no module.

## Reviewed annual closure

**Préparer la clôture** opens the existing Formsnap confirmation with the exact selected year,
classes and counts. Choose **Reprendre** or **Mettre de côté** for every module. Reprise requires an
explicit later academic year. Type the exact closing year and acknowledge retaining the necessary
PDFs before **Clôturer**. The application cannot confirm that a downloaded file was kept.

- Reprise creates empty annual classes and new contexts: no student, score, comment, planning or
  deadline is copied. The existing public class and module URLs continue to resolve. The previously
  reviewed public snapshot remains visible, including its old year/dates, until the teacher saves,
  reviews and manually publishes the new promotion. Reprise itself never publishes a draft.
- Mise de côté retains the entire private module and disables its old public module link. The module
  remains findable on teacher home and may later be attached to a class. That recovery creates an empty
  context; only a manual publication reactivates the retained module URL.
- A continued class keeps its public directory identity; a class with no continued module loses its
  directory. New-year classes with a conflicting existing name are rejected instead of merged silently.

One active module belongs to one class. Attaching it to another class makes an independent pedagogical
copy with fresh rubric/resource identities, without grades, students, calendars or deadlines. Legacy
multi-class contexts that make a continuation ambiguous are rejected, never converted by deleting notes.

## Records and consistency

The closure transaction archives old contexts and removes only the selected year's classes, students,
corrections, criterion scores, submissions/delay decisions, comments, correction proposals and decision
receipts. It retains modules, objectives, preparation, local source references, selected links, public
instructions/exercises, rubrics, old calendars/deadlines, publication snapshots and teacher access.
Old context history remains private without the removed roster/results. The closed year cannot be
reopened or accidentally recreated. No file on the Mac, Teams, GitHub or Drive is deleted.

Teacher authorization precedes private reads and input parsing. Mutations require same origin, strict
validation and the reviewed snapshot token. Changes to roster, points, comments, modules, calendars,
publications or public-link bindings invalidate that token, even if counts stay equal. HTTP 409 requires
an explicit refresh and new confirmation. Revisions invalidate stale manual and MCP drafts.

A request UUID, input hash and receipt are stored in the transaction. An identical retry returns the
original receipt before checking the new state; a different input using that UUID is rejected. The
receipt contains only identities, year, action, timestamp and counts. A failed transaction rolls back
all closure, new contexts, link bindings and the receipt. Responses are private/no-store and noindex.

## Schema and checks

Migration `0006` introduces annual lifecycle/receipts; `0008` adds durable public-link bindings and
module pause/review metadata. They are versioned offline migrations. Existing/cloud databases have
not been migrated by routine validation. Never purge real records in a test.

Tests use disposable fictional databases and cover archive/reopen, year isolation, retry/rollback,
continued empty classes, stable links, pause/recovery and manual republication. Browser scenarios use
an isolated loopback copy. HTTPS, real passkeys, screen readers and physical phones require separate
acceptance. Downloaded PDFs are external records and cannot restore criterion-level data after closure.
