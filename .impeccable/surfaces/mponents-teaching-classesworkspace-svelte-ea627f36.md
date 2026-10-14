---
version: 1
slug: "mponents-teaching-classesworkspace-svelte-ea627f36"
primary_target: "src/lib/components/teaching/ClassesWorkspace.svelte"
related_targets: ["src/routes/enseignant/classes/+page.svelte"]
---

# Classes and reusable modules

Mode: Operate. Léo selected `classes-context` on 12 October 2026 and authorized implementation.
Class name/year, a common editable roster (paste/CSV import) and module association are in scope.
No student accounts, grades, annual purge or public publication here. Save through teacher-only services.

## Direction contract

THESIS: Manage an annual roster while keeping its reusable modules beside it, without duplicate class pages per module.

OWN-WORLD: Inherit luma, Inter, semantic light/dark tokens, Lucide, flat separators and rounded controls inside the existing collapsible Sidebar.Inset.

STORY: Choose a class, import or adjust its students, and attach a module without copying its grades.

FIRST VIEWPORT: Page heading and class selector precede the class name/year. The roster occupies roughly two thirds of the working width; associated modules occupy the right third. Import and add actions precede roster rows; attach follows the module list.

FORM: Grounded structure 7, seed `438ca9c2`, code-led; selected sketch `.impeccable/mocks/decision/lot2-classes-context.html`. On phones stack these sections and keep labels visible. Changes use explicit save, pending feedback and revision conflicts. The signature is the shared roster and module association in one working view; inherited control/sheet motion only.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance


## Implementation and finish evidence

Implemented with private teaching services and explicit Formsnap/Superforms/Zod forms. Fictional
local CRUD checks, nested field/error wiring, revision conflict handling and desktop/mobile
light/dark renders are recorded in `.impeccable/review/lot2/`. The first finish review requested
one roster-dialog focus fix; its verdict pass resolved it and returned `ship` for the scored
fix, with no remaining material findings from the original review. No raster artwork was added.
The incumbent DESIGN.md and sidecar are checked by the post-build documenter; preserve luma.
No cloud migration or deployment belongs to this acceptance evidence.
