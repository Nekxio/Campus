---
version: 1
slug: 'src-lib-components-grading-rubriceditor-svelte'
primary_target: 'src/lib/components/grading/RubricEditor.svelte'
related_targets:
  - 'src/lib/components/grading/RubricResults.svelte'
  - 'src/lib/components/grading/RubricAssessmentPicker.svelte'
  - 'src/lib/components/grading/RubricField.svelte'
  - 'src/routes/enseignant/modules/[moduleId]/bareme/+page.svelte'
---

# Direct rubric definition with visible calculation rules

Mode: Operate. Léo selected `rubric-table` through the refreshed Impeccable decision
page on 12 October 2026. The choice prioritizes accessibility, useful information within
reach, direct returns and few clicks between evaluations. Implementation is complete and locally
verified; this is an ordinary extension of the incumbent system.

## Direction contract

THESIS: Edit scoring lines directly and understand their relationship to the module's
calculated results without a compulsory sequence of steps.

OWN-WORLD: Inherit Coursely luma, Inter, semantic light/dark tokens, Lucide, rounded
shadcn-svelte controls and the existing sidebar inset. No design-system replacement.

STORY: Open the module rubric, select an evaluation directly, edit its line labels,
group assignments and integer maxima, inspect the derived totals and result rules,
then explicitly save. Changing the active evaluation keeps the current draft.

FIRST VIEWPORT: Heading and return/save actions precede the evaluation tabs. The
selected evaluation has a table of editable labels, groups, maxima and row actions.
Eight example lines are visible. Group totals and the evaluation maximum derive from
their lines; the right-hand panel shows weights, result outputs and calculation rules.
Multiple independent results remain available instead of a compulsory single average.

FORM: Grounded structure 2 from the refreshed five-candidate hand, seed `dfa5571f`,
re-roll 1, code-led. Chosen sketch `.impeccable/mocks/decision/lot3-rubric-table.html`.
The signature is direct table editing beside its calculated consequences. Evaluation
tabs and groups remain freely accessible, with keyboard roles and preserved input.
On narrow screens reflow into labeled line fields and an accessible calculation section;
preserve the 44px control floor and ordinary control-state motion.

## Product boundaries and states

Use the approved business plan and Formsnap/Superforms/Zod. Evaluations may be graded
or formative; the latter do not contribute to results. The example 15/25/60 weights and
/15, /100, /120 maxima do not constrain other modules. Calculation rules are structured
data, never executable expressions. A rubric belongs to the durable module rather than
an annual class. Stable scoring-line identities and raw points survive replacement;
new lines remain ungraded and scores above a reduced maximum are flagged, not clamped.
Explicit save applies the replacement and recalculation without an extra approval step.
Surface pending, invalid and conflicting revisions while retaining the teacher's draft.

No cloud migration, publication, PDF export or agent integration is included in this lot.
The detailed correction is implemented with its separately approved `correction-bottom-summary` choice.

## Implementation and finish evidence

Implemented on 12 October 2026 as `rubric-table`, with direct evaluation tabs, editable scoring
lines, derived group/evaluation maxima, structured result rules and class-context deadlines.
The calculation column sits beside the definition table at 80rem; narrow criteria containers
reflow to labeled fields. Formsnap/Superforms/Zod, explicit save, stable IDs/raw-score preservation
and error/conflict draft retention remain in place.

Compared `RubricEditor.svelte`, `RubricResults.svelte`, `RubricField.svelte`,
`src/lib/grading/rubric-form.ts`, `src/lib/domain/grading.ts` and the private grading services/route
with this contract and `.impeccable/mocks/decision/lot3-rubric-table.html`.
Opened `.impeccable/review/lot3/rubric-{desktop,mobile,user-810}.jpg`; the full-page supplements
and validation records are retained alongside them. The fresh finish review matched rubric fidelity.
Latest lot 3 validation reports 105 tests in 16 files, zero Svelte/application or operator-script
TypeScript errors/warnings, formatting/lint and the Workers build passing. Read
`../review/lot3/verification.json` and `../review/lot3/finish-review.md` for the scope and limitations.

The incumbent-system documentation check compared global luma tokens and shared controls with
`DESIGN.md` and `.impeccable/design.json`. Both system files remain unchanged; historical demo/home
wording is reported in the README without a token or world repair. Real-device, screen-reader and
full HTTPS passkey acceptance remain outstanding. Static proposal images remain design references;
runtime captures and review records supply implementation evidence. No raster assets were added.
