---
version: 1
slug: "src-lib-components-teaching-moduleeditor-svelte"
primary_target: "src/lib/components/teaching/ModuleEditor.svelte"
related_targets: ["src/routes/enseignant/modules/nouveau/+page.svelte","src/routes/enseignant/modules/[moduleId]/+page.svelte"]
---

# Durable module creation and editing

Mode: Operate. Léo selected `module-outline` on 12 October 2026 and authorized implementation.
Create/edit a draft with identity, preparation, local source reference, selected external links and optional class/session planning. The home module list inherits its existing layout.
No uploads, Drive credentials, publication or rubric/correction editor in this lot.

## Direction contract

THESIS: Keep the module's four sections findable beside the form, allowing a draft without compulsory class assignment.

OWN-WORLD: Existing luma neutral surfaces, Inter, Lucide, semantic themes, flat separators and rounded shadcn-svelte fields; retain the shared sidebar inset and account/theme footer.

STORY: Name the module, complete preparation and links, optionally associate annual classes and dates, then save a reusable draft.

FIRST VIEWPORT: Heading and create/save action sit above a 210px local section rail. Informations opens with name, description and objectives. Compact guidance sits to its right; it yields to the form on narrower widths. The four sections are Informations, Préparation, Liens étudiants, Classes et planning.

FORM: Grounded structure 5, seed `68c2630e`, code-led; selected sketch `.impeccable/mocks/decision/lot2-module-outline.html`. On phones replace the local rail with a labeled section selector. Preserve unsaved values, validate before save, expose progress/success/errors, protect revisions. The signature is moving between sections without losing the draft; inherited control/dialog motion only.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance


## Implementation and finish evidence

Implemented with private teaching services and explicit Formsnap/Superforms/Zod forms. Fictional
local CRUD checks, nested field/error wiring, revision conflict handling and desktop/mobile
light/dark renders are recorded in `.impeccable/review/lot2/`. The first finish review requested
one roster-dialog focus fix; its verdict pass resolved it and returned `ship` for the scored
fix, with no remaining material findings from the original review. No raster artwork was added.
The incumbent DESIGN.md and sidecar are checked by the post-build documenter; preserve luma.
No cloud migration or deployment belongs to this acceptance evidence.
