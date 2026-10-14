---
version: 1
slug: 'src-lib-components-grading-gradegrid-svelte'
primary_target: 'src/lib/components/grading/GradeGrid.svelte'
related_targets:
  - 'src/routes/enseignant/notation/+page.svelte'
  - 'src/routes/enseignant/notation/+page.server.ts'
---

# Module results beside the selected student's summary

Mode: Operate. Léo selected `grid-split` on 12 October 2026 through the Impeccable
decision page. Implementation is complete and locally verified. The rubric editor and detailed
correction use the approved `rubric-table` and `correction-bottom-summary` choices.

## Direction contract

THESIS: Keep the class's module-result grid visible while inspecting one student's
assessment results and pending cases beside it.

OWN-WORLD: Inherit Coursely luma, Inter, semantic light/dark tokens, Lucide, rounded
shadcn-svelte controls and the collapsible sidebar inset. No new visual identity.

STORY: Select a module and annual class, find the student, inspect their summary, then
open the separately chosen detailed correction when scoring lines are needed.

FIRST VIEWPORT: Heading, module/class selectors and search/status filter precede a
compact results grid. Its selected row corresponds to the right-hand summary: assessment
results, absence/pending states, project-delay adjustment and the detailed-correction action.
The grid contains results only; scoring-line details and the private semester comment
belong to the correction workflow. Multiple independent result outputs remain possible.

FORM: Grounded structure 6, seed `3d147b93`, code-led. Chosen sketch:
`.impeccable/mocks/decision/lot3-grid-split.html`. Keep explicit selected-row feedback;
the signature is the grid/summary correspondence without losing class context. On narrow
screens use labeled result rows and an in-flow selected summary, keeping a clear return
to the list. Preserve the 44px control floor and ordinary control-state motion.

## Product boundaries and states

Reuse the approved business plan. Module rubrics are durable; scores are scoped to the
student's class context. Whole-number input points and precise calculations are separate
from the final one-decimal display. A blank score is not zero. Unjustified absence gives
zero to that assessment; justified absence or invalid scores keep required results pending.
Do not calculate a definitive total from incomplete required data. Teacher-only services,
Formsnap/Superforms/Zod and explicit saved/error/conflict states remain required.

No student or pedagogy account, publication, AI proposals, PDF export or cloud migration
is introduced by this design approval. Those remain their later approved implementation lots.

## Implementation and finish evidence

Implemented on 12 October 2026 as `grid-split`. Module/context selection, search and completion
filters precede the result roster and selected assessment summary. The desktop table appears at
80rem; the roster and summary split at 64rem. Narrow screens use labeled result rows and an
in-flow summary with a return to the list. The grid opens the detailed correction in the same
class/module context and supports independent result outputs.

Compared `GradeGrid.svelte`, the private notation loader, `src/lib/domain/grade-calculation.ts`
and `src/lib/server/teaching/grading.ts` with this contract and
`.impeccable/mocks/decision/lot3-grid-split.html`. Opened
`.impeccable/review/lot3/grid-{desktop,mobile,user-810}.jpg`; full-page supplements and validation
records remain alongside them. The fresh finish review matched grid fidelity. Latest lot 3
validation reports 105 tests in 16 files, zero Svelte/application or operator-script TypeScript
errors/warnings, formatting/lint and the Workers build passing. Read
`../review/lot3/verification.json` and `../review/lot3/finish-review.md` for scope and limitations.

The incumbent-system documentation check compared global luma tokens and shared controls with
`DESIGN.md` and `.impeccable/design.json`. Both system files remain unchanged; historical demo/home
wording is reported in the README without a token or world repair. Real-device, screen-reader and
full HTTPS passkey acceptance remain outstanding. Static proposal images remain design references;
runtime captures and review records supply implementation evidence. No raster assets were added.
