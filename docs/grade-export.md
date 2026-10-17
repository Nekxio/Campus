# Final module PDFs

The current contract follows the [15 October teacher workflow](plans/2026-10-15-teaching-workflows.md).
Both exports use saved records and the same grading calculations. Neither includes private comments,
submission URLs or an invented annual average. Missing or invalid required results block a final PDF;
there is no provisional export presented as final.

## Class PDF

In **Notation**, `pdf-inline` remains below the module/class selectors and before search filters.
**Télécharger le PDF** exports the entire selected class, regardless of search, filters or selected
student. The A4 landscape document contains module, class and academic year, every student name,
each section's /20 mark with its weight in the header, and all defined final results. It contains
no criterion detail or private comment. No export date is printed in its header.

A nonempty class and at least one final result are required. All students must have complete valid
required results. Unjustified absence is a definitive zero; justified absence/retake remains pending.
Formative sections outside the results do not block export and may display “En attente”. More than
five numeric columns are split into tables on additional pages, repeating the complete roster.

## Individual PDF

**PDF individuel**, available in the selected student's grid summary and detailed correction, exports
one student and one module. It contains name, class, academic year and module title, every section's
status, full rubric with obtained points and maxima, group subtotals, section /20 marks, weights and
contributions to every final result. Quiz groups show the equally weighted mean of normalized quiz
scores, never a heterogeneous raw-point sum. Absences and explicit project non-submission/refusal
remain visible. Module description and private semester comments are omitted.

Only this student's required results must be complete; another incomplete student does not block
an individual PDF. Unsaved correction changes disable the action. Inputs retained during absence
are labeled as excluded from that calculation. A PDF is a final output, not a restorable database backup.

## Private reads and browser rendering

The class route is `GET /api/teaching/contexts/[contextId]/export`; the individual route adds
`/students/[studentId]/export`. Both authorize a teacher before parsing identities or opening private
records. The server rereads the exact context, rubric, roster and saved corrections in one transaction,
checks class membership, recalculates and constructs a strict export allowlist. Success and errors
use `private, no-store` and `noindex, nofollow`. No teacher credential enters the export payload.

Changed/incomplete data returns HTTP 409 and produces no PDF. The interface retains the current
work and offers an explicit refresh. PDF buttons become usable after client initialization; a first
click cannot be consumed before their browser handler exists. A failed read or generation is retryable.
Archived contexts remain exportable while their class/student records remain. Archive does not freeze
a rubric copy; final documents should be retained before later rubric changes or annual closure.

The pinned pdfmake renderer and bundled fonts load lazily in the browser. No rendering service,
upload, stored PDF or remote font is used. Large library/font chunks retain Vite's size advisory.
The bundled font supports the checked Latin accents, not every writing system.

## Verification boundary

Domain/service/access tests cover completeness, full class projection, one-student scope, section
weights, absent versus missing values, strict payloads and private errors. Browser scenarios in
`tests/browser/pdf.spec.ts` and `teaching-workflows.spec.ts` exercise actual downloads and extract PDF
text from fictional data. Current execution results and remaining checks are recorded in the teaching
workflow plan; historical checks are not a claim that every later revision passed. Physical-device,
screen-reader and real HTTPS acceptance remain distinct checks.
