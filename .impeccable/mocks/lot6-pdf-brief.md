# Final module grade-grid PDF — design brief

Mode: Operate. This workflow extends the private `grid-split` grading surface within the existing Coursely luma system. Léo's validated plan authorizes complete final module PDFs, followed separately by annual archive/purge work.

- Audience/task: the teacher downloads the final complete class/module grid for the school once all required calculated outputs are definitive. No school account or provisional export.
- Content: module title, class/year, export date, all roster names and every defined result column. One-decimal marks reuse `formatMark`; source raw precision and calculations are unchanged. No criterion lines, correction histories, private comments, submission links or undefined annual average.
- States: no context/module/results/students, incomplete/invalid required results, ready, fresh-data loading, generation and retryable error. A justified unresolved absence blocks; an unjustified absence resolved as zero does not. Formative activities do not block. Existing `calculateStudent.complete` requires nonempty defined outputs and ready required assessments.
- Entry/read scope: place the chosen export controls within the existing grid and teacher access. Search, status filters and selected student never reduce the exported class. Revalidate fresh authorized saved data on export; project only names/final result columns for the browser PDF renderer. Keep this read separate from teaching writes, without exposing grading data publicly.
- Implementation boundary: generate/download the final PDF in the browser, no rendering service or cloud operation. Check twelve fictional students, accents, long labels/names, one/two or many result columns and multi-page continuation. Choose a readable print layout; column/page adaptations must preserve all results. Reuse installed shadcn controls and current validation conventions. Design choice precedes code; annual purge needs its own later choice and confirmation.

Seed: `93dcd3fc`, grounded hand 3/4/2. Seven structures in `lot6-pdf-design-round.json`; proposed HTMLs are illustrative first viewports with explicitly fictional data. App source and business data unchanged at planning stage.

## Approved direction contract

- **THESIS:** the teacher sees readiness for the complete module grid and downloads it in one action.
- **OWN-WORLD:** incumbent luma, Inter, Lucide and shadcn controls; no global theme or shell change.
- **STORY:** module and class/year, then final-export availability, then consultation filters, class grid and selected-student summary.
- **FIRST VIEWPORT:** a compact bordered inline band below selectors; readiness left, primary download right, stacked full-width on mobile. The existing labelled filters, established grid spacing and assessment summary remain because this workflow extends the live grid rather than replacing it. The sketch's compressed whole-page fixture is illustrative; actual tables remain scrollable with the incumbent touch targets and long-content wrapping.
- **FORM:** seed `93dcd3fc`, explicit `pdf-inline` choice returned by board `5de298b2`, code-led, no comp. Shadcn Alert/Button/Spinner, existing luma tokens, strict data projection and error/refresh states.

The exact choice is persisted in `lot6-pdf-design-round.json`; PDF implementation is active. Annual archive/purge is not implemented in this step.
