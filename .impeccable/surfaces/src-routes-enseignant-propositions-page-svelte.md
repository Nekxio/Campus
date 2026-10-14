---
version: 1
slug: "src-routes-enseignant-propositions-page-svelte"
primary_target: "src/routes/enseignant/propositions/+page.svelte"
related_targets: []
---

# Correction proposal verification

Mode: Operate. Design selected and implemented locally on 12 October 2026.
Léo chose **Comparaison dans la correction** (`proposal-inline-comparison`) in the Impeccable
surface round `0e5f8508`, with the code-led build path unchanged.
Chosen first viewport: `.impeccable/mocks/decision/lot4-proposal-inline-comparison.html`.
The seven grounded compositions and the dealt three are retained in
`.impeccable/mocks/lot4-proposals-design-round.json`.

- **Job and outcome:** the teacher reviews one agent proposal for an exact student, class/year,
  module and assessment. Open from Notation, compare against the recorded correction, adjust the
  proposed integer points if needed, then decide explicitly. Existing results remain authoritative
  until accepted. There is no bulk acceptance or private justification field per criterion.
- **Chosen composition:** inherit the compact student/context strip, direct assessment and group
  navigation and persistent lower assessment/result summary from the existing detailed correction.
  Each rubric line shows its label, rubric description, maximum and Enregistré / Proposé / Retenu.
  Retenu is the editable value; original proposed values remain visible. Keep the current submission,
  absence and delay decisions clear and use the established calculation rules for result previews.
  The fictional example distinguishes 32/40 recorded, 35/40 proposed and 34/40 retained.
- **Actions:** Valider les points and Refuser belong to the persistent decision area. The semester
  comment has its own comparison and explicit Reprendre le commentaire action, retaining the current
  text unless chosen separately. Accepting points must not silently replace a semester comment.
  Previous/next proposal controls and a return to the correction/list provide direct navigation.
- **States:** loading, empty queue, missing rubric, valid proposal, manual adjustments, saving, failed
  save with draft retained, accepted, rejected and stale proposal. A changed rubric or correction
  blocks point acceptance; a changed comment blocks the affected comment decision. Explain what
  changed and support a fresh proposal/reconciliation, with no silent overwriting or score clamping.
- **Constraints and adaptation:** preserve Coursely luma, Inter, Lucide, sidebar inset, avatar and theme
  controls. Implement with shadcn-svelte, Formsnap/Superforms/Zod, labeled integer fields and clear
  maximum/error associations. Keep 44px targets and unclipped focus rings. Desktop work scrolls above
  the visible summary; narrow layouts use labeled comparison rows and an in-flow summary that does
  not obscure the active input or mobile keyboard. No public results, publication or new storage.

The HTML sketch records the chosen static composition. The direction contract below governs the
implemented surface; the implementation/evidence note records the finished local scope.

## Direction contract

THESIS: Review proposed criterion points in the familiar correction workspace, with recorded,
proposed and retained values beside each other and an explicit decision after viewing the impact.

OWN-WORLD: Inherit the existing neutral Coursely luma tokens, Inter, Lucide, rounded shadcn-svelte
controls, inset sidebar and light/dark behavior. No system change.

STORY: Open an exact proposal from Notation, compare/adjust points by group, inspect calculated
results, accept or refuse, and decide separately whether to use the proposed semester comment.

FIRST VIEWPORT: Compact student/class/module/assessment context and proposal pager above the active
group. Rubric labels and maximums align with Enregistré / Proposé / Retenu. The summary and decision
remain at the bottom on supported desktop sizes; the comment strip opens an in-flow comparison.
Narrow screens reflow labeled rows and summary without covering the input. The signature interaction
is live impact comparison while retained points change; use the existing control-state motion only.

FORM: Grounded structure 7, seed `0e5f8508`, code-led, selected as `proposal-inline-comparison`.
Match `.impeccable/mocks/decision/lot4-proposal-inline-comparison.html`.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the
verdict, DESIGN.md, and every shipping raster carrying its provenance


## Implementation and finish evidence

Implemented with the selected `proposal-inline-comparison` composition. `ProposalReview.svelte`,
`ProposalReviewDraft.svelte` and `ProposalScore.svelte` serve the private route. Notation links to
the queue with its current teaching context; the existing Notation navigation stays active.
At 64rem and above the comparison uses aligned columns with sticky headers; below it, each labeled
criterion spans the row above three explicitly labeled values. At 80rem wide and 36rem high the
work scrolls above the persistent result/decision summary. Narrower views keep the summary in flow.
The expanded comment comparison retains its independent explicit decision and typed Formsnap form.

The independent full supplied-surface finish review returned `ship` with no material fixes;
see `.impeccable/review/lot4-proposals/finish-review.md`. Six final captures cover 1440px desktop,
the actual 1280px viewport, 810px reflow, 390px phone reflow, dark mode and the expanded dark comment.
All six captures were replaced after Inter Variable loaded correctly; `capture-metadata.json` records their hashes, themes and dimensions. The independent full rereview supersedes the withdrawn initial verdict.
`detector.json` is `[]`. The independent documenter preserves `DESIGN.md` and `.impeccable/design.json`;
no visual-system change was approved or needed. Both independent roles used fresh generic agents
because this harness exposes no dedicated shipped-role agent type. Their reports record the scope.
These are local fictional-data captures; quantitative contrast, screen readers, real devices and
full HTTPS acceptance were not established by those reviews. Existing global wording drift was
reported separately and was preserved under this surface-extension scope.

The fictional browser workflow also verifies integer errors/associated focus, disabled absence
fields, dirty navigation, live 14.4/14.8 retained results, separate points/comment acceptance,
comment drafts surviving point acceptance and a single editor when changing proposals. A transient
hot-reload duplicate was excluded by repeating the complete workflow from a fresh page load.
