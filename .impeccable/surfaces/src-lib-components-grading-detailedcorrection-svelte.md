---
version: 1
slug: 'src-lib-components-grading-detailedcorrection-svelte'
primary_target: 'src/lib/components/grading/DetailedCorrection.svelte'
related_targets:
  - 'src/lib/components/grading/DetailedCorrectionDraft.svelte'
  - 'src/lib/components/grading/CriterionScore.svelte'
  - 'src/lib/components/grading/CorrectionField.svelte'
  - 'src/routes/enseignant/notation/[contextId]/[studentId]/+page.svelte'
---

# Detailed correction with a persistent assessment summary

Mode: Operate. Léo selected `correction-bottom-summary` through Impeccable on
12 October 2026, after two refinements. Implementation is complete and locally verified.
The two other approved and implemented surfaces are the direct
rubric table (`rubric-table`) and the grade grid with student sheet (`grid-split`).

## Direction contract

THESIS: Score each criterion while keeping the student's identity, submission,
assessment status and calculated results within reach.

OWN-WORLD: Inherit Coursely luma, Inter, Lucide, semantic light/dark tokens,
rounded shadcn-svelte controls, the existing sidebar inset, avatar and theme switch.
Do not replace the incumbent visual system.

STORY: Open a correction from the module's grade grid, select an assessment and
group freely, enter integer criterion points, inspect the resulting assessment
and module results, then save explicitly. Previous/next student arrows are direct
navigation; preserve or resolve pending edits before leaving. Return to the grid
is always available. Semester comments remain separate from criterion scoring.

FIRST VIEWPORT: A compact upper strip shows the student, class/year/module,
assessment selector, status selector, previous/next arrows and position, external
submission link, submission/deadline information and automatic delay penalty.
Below, direct group controls sit beside the active group's title and subtotal.
Each criterion has a readable label, its rubric description when supplied, an
integer point field and visible maximum. Eight example lines fit on desktop. A persistent lower
summary on supported desktop sizes shows each assessment's raw points, normalized mark, weight and delay
calculation, then the final result. The Save action belongs to this persistent
summary. The private semester comment has a discreet separate entry point.

FORM: Structure 4 of the reroll-2 five-candidate hand, seed `1307eb37`, code-led.
Chosen sketch: `.impeccable/mocks/decision/lot3-correction-bottom-summary.html`.
The teacher explicitly pinned the context strip, student arrows and readable
assessment-summary table. The chosen signature is the full-width active group
above a persistent lower summary. Preserve the arrangement, palette, type and
density; supply responsive behavior and all states absent from the fixed sketch.
On narrow screens wrap context controls, preserve labeled score fields and 44px
targets, and reflow the summary without obscuring the active field or last line.
Long groups scroll in a bounded content area above the fixed summary; longer
labels and many groups must not overlap the save action or trap keyboard focus.

## Product boundaries and states

Use Formsnap/Superforms/Zod and the approved business plan. Scores are integer
raw points, empty is ungraded rather than zero. Calculated results retain full
precision internally and display the final mark to one decimal. The example
15/25/60 weights and /15, /100, /120 maxima are illustrative, not universal rules.
Multiple independent module results and formative assessments remain supported.
Quiz results sum raw points and maxima rather than averaging percentages.

Use the four approved assessment states: To assess, Graded, Unjustified absence
(zero for that assessment) and Justified absence / resit pending. Absence disables
point inputs. Draft persistence is not a fifth assessment state. No private
criterion justification fields. The semester comment is private to the teacher.
Scores and comments belong to the annual class/module assignment; the module
and its rubric persist independently of annual student data.

External GitHub/Teams submissions carry a link and received date. Delay follows
the approved Paris calendar-day rule and subtracts one point per day from the
project mark converted to /20; manual exceptions and refusals remain explicit.
Display raw and adjusted marks clearly. Rubric replacement preserves stable
line identities and raw points; new lines remain pending, excess points are
flagged and not clamped. Recalculation never silently transforms raw scores.
Required states include no rubric, no students, incomplete correction, invalid
points, saved/pending edits, failed save and revision conflict with draft retained.

No publication, agent proposals, PDF export, annual purge or MCP integration is
implemented by this design round. These remain later implementation lots.

## Implementation and finish evidence

Implemented on 12 October 2026 as `correction-bottom-summary`. Direct assessment/group navigation,
previous/next student controls, integer points, submission dates/decisions and the separately saved,
copyable private semester comment are active. At supported desktop sizes (80rem wide and 36rem
high), a bounded work body keeps the context strip, result summary and Save action available.
History, auxiliary panels, errors and complete deduplicated calculation diagnostics scroll inside
that body; summary cells use concise issue counts. Narrow layouts reflow in document order.
Criterion inputs associate maximum/range guidance with their Formsnap descriptions and errors.

Compared `DetailedCorrection.svelte`, `DetailedCorrectionDraft.svelte`, `CriterionScore.svelte`,
`CorrectionField.svelte`, `src/lib/grading/correction-form.ts`, grading domain/calculation contracts,
private services/loaders/PATCH endpoints and the chosen
`.impeccable/mocks/decision/lot3-correction-bottom-summary.html`.
Opened `.impeccable/review/lot3/correction-{desktop,mobile,user-810}.jpg`,
`correction-mobile-full.jpg`, `correction-dark-full.jpg`, `correction-long-group.jpg` and
`correction-long-group-keyboard.jpg`. The long-group captures include twenty temporarily added
fictional lines; the fixture was restored after capture. They retain the final result name,
pending state, issue count and Save action while the full diagnostic list remains in the work body.

The fresh reviewer used the degraded role contract. Its first finish review requested maximum
association and summary persistence; both were resolved across two fix batches. Final disposition
`ship` scores those two fixes only, not a second full-surface or server/calculation audit.
`layout-final.json` retains initial pre-fix geometry; `fix-layout.json`, final captures and
`finish-review.md` record the correction. Latest lot 3 validation reports 105 tests in 16 files,
zero Svelte/application or operator-script TypeScript errors/warnings, formatting/lint and the
Workers build passing. Manual scenarios cover decimal rejection, absence re-enabling, dirty-exit
cancellation, saved reload and HTTP 409 with draft retained; see `../review/lot3/verification.json`.

The incumbent-system documentation check compared global luma tokens and shared controls with
`DESIGN.md` and `.impeccable/design.json`. Both system files remain unchanged; historical demo/home
wording is reported in the README without a token or world repair. Real-device, screen-reader and
full HTTPS passkey acceptance remain outstanding. Static proposal images remain design references;
runtime captures and review records supply implementation evidence. No raster assets were added.
