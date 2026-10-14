---
version: 1
slug: 'src-routes-page-svelte'
primary_target: 'src/routes/+page.svelte'
related_targets: []
---

# Teacher home

Mode: Operate. Target: `src/routes/+page.svelte`.

Léo selected **Prochaine intervention** in the Impeccable composition round (question
`3895529b`, option `next-intervention`, code-led). The approved reference is
`.impeccable/mocks/decision/next-intervention.html`; no generated image is required.

The home exposes the next intervention, module preparation, student materials and access to
grading. Use fictional classes, students and modules, clearly identified as demonstration
data. Provide local previews for the home actions; no backend, authentication or actual
publication. Grade preview: integer input validated with Zod, disabled when absent; no
implicit empty-to-zero conversion. Do not implement total or absence scoring policies yet.

## Approved shell update

On 12 October 2026, Léo approved adapting the dashboard-01 shell while preserving the luma
palette and teacher-home content: an 18rem inset/offcanvas sidebar, header toggle, the existing
four navigation entries without quick actions, a demo user menu with three disabled actions
and no billing item, and the theme selector still visible below the profile. This shell
geometry supersedes the original sketch’s rail geometry. Desktop collapse must preserve
filters and grade state, exclude hidden navigation from focus, and close the account menu.

## Direction contract

THESIS: Preparing the next course leads; all other modules remain immediately reachable in a
compact table. No analytics or decorative metric cards.

OWN-WORLD: Existing neutral shadcn-svelte luma tokens, white workspace, pale navigation,
Inter, restrained Lucide icons, consistent borders and native shadcn controls.

STORY: See the next module and what is ready, open its preparation or student preview, then
find another module or its notes through class filters and search.

FIRST VIEWPORT: A left navigation rail, a slim demo header and a main heading. The next
intervention occupies the upper work area, preparation states beside it, followed by the
modules table. Primary action: open preparation. On phones, stack the preparation underneath
the intervention, move navigation into a sheet and render modules as labeled rows.

FORM: Grounded structure 5, next intervention followed by modules; surface seed `6917b567`.
The selected sketch fixes composition, neutral palette, typography and density.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
