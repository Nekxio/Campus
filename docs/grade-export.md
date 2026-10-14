# Final module grade-grid PDF

The teacher downloads the complete final grid from **Notation**. The approved `pdf-inline`
composition places readiness and **Télécharger le PDF** below the module/class selectors, before
the search filters. Search, filters and the selected student never limit the exported roster.

The file contains the module title, class, academic year, export date, every student name and
every defined module result on 20. It omits criterion lines, assessment details, absence reasons,
submission links, correction history and private semester comments. No extra average is invented.

## Availability and fresh reads

`gradeExportStatus` reuses `calculateStudent.complete`. A nonempty class and at least one defined
result are required. Missing required points, unresolved justified absences and invalid retained
scores block export. An unjustified absence calculated as zero is definitive; formative assessments
outside result definitions do not block it. Calculations retain full precision and `formatMark`
renders one decimal in the PDF.

`GET /api/teaching/contexts/[contextId]/export` authorizes a teacher session before validating IDs
or opening the database. It rereads the exact module/context, retained roster, rubric, deadlines and
saved scores within one transaction. Archived contexts remain exportable while their class/student
records exist. Deleted or foreign contexts never fall back to another class. The server constructs a strict allowlist of names and final marks; private grading records
are not serialized into the export response. Success and errors use `private, no-store` and
`noindex, nofollow`.

A grid that has become incomplete since opening returns HTTP 409 and produces no document.
The interface retains the current page, explains the problem and offers **Actualiser la grille**.
Read/network/generation failures remain retryable. There is no export mutation form, so this
workflow uses the existing shadcn Alert, Button and Spinner; teaching mutation forms keep Formsnap.

## Browser rendering

`src/lib/client/grade-pdf.ts` builds an A4 landscape document with repeated table headers and page
numbers. Rows wrap for long names and labels. More than five result columns are split into groups
on additional pages; each group repeats the complete roster and preserves every result. Numeric
values remain selectable text rather than a screenshot of the HTML grid.

The pinned pdfmake 0.3.11 renderer and bundled Roboto fonts are loaded only on export. No remote
font, rendering service, upload, stored PDF or new cloud migration is involved. Vite prebundles
these lazy dependencies during development to avoid its first-import reload; production loading
remains lazy. The library and font chunks exceed Vite's default size advisory; that warning is
retained rather than suppressed. The bundled font covers the Latin accents checked here; it is
not a universal glyph set for every writing system.

The implementation follows the official [browser installation](https://pdfmake.github.io/docs/0.3/getting-started/client-side/)
and [table pagination](https://pdfmake.github.io/docs/0.3/document-definition-object/tables/) contracts.

## Verification

- Domain/service/access tests cover full projection, empty/no-result blocking, unresolved states,
  invalid points, changed saved corrections/rubrics, exact context selection and private error responses.
- An isolated loopback preview downloads all twelve fictional students while the visible grid is
  filtered to one. Extracted PDF text preserves names with accents and the two defined result columns.
- Additional local renderer checks cover one result and eighty fictional rows/seven result columns,
  including a long name, repeated headings, all columns and the last student across twelve pages.
- Light/dark desktop, the user's 1280-pixel width, 390-pixel mobile, keyboard focus and stale-data
  recovery are checked. These browser checks do not substitute for a physical phone or screen reader.

The annual archive/purge workflow is implemented with the approved continuous dossier. Archived contexts with retained class/student data remain eligible for final export; purged contexts are unavailable. See `annual-lifecycle.md`.
