# Campus design system

## Direction

A calm, warm teaching workspace: cobalt actions, warm paper surfaces and clear course reading.
Campus itself is the reference. Keep the approved home, sidebar, preparation, grading and public
course compositions. One teacher prepares, assesses and publishes; students read courses without
an account. No promotional sections, invented evidence, stock photography or external reference.

## Colors

All colors live in semantic variables in src/routes/layout.css, including syntax, quiz feedback,
overlays and shadows. Components never introduce raw colors. No decorative gradients.
The self-contained fatal-error HTML mirrors these core variables with a system-font fallback;
it must remain readable when the application bundle cannot load. Static identity assets derive
their colors from the same palette.

| Role                            | Light                | Dark                  |
| ------------------------------- | -------------------- | --------------------- |
| Primary cobalt                  | oklch(0.48 0.19 263) | oklch(0.78 0.111 260) |
| Primary text                    | #FFFFFF              | #17253F               |
| Primary hover                   | oklch(0.42 0.18 263) | oklch(0.85 0.074 260) |
| Background                      | #F7F6F2              | #202226               |
| Card / input                    | #FFFFFF              | #292C31               |
| Foreground                      | #282C33              | #F2F1ED               |
| Muted surface                   | #EEEDE7              | #303338               |
| Supporting text                 | #5A6068              | #B3B6BE               |
| Sidebar                         | #EEEDE7              | #1B1D21               |
| Separator                       | #D5D4CC              | #4D5157               |
| Control border                  | #8B8E95              | #8B9098               |
| Selected action surface         | #E8EDFC              | #283B5D               |
| Selected action text            | #1E43B8              | primary               |
| Amber accent / deadline text    | #805416              | #E7C47F               |
| Amber accent / deadline surface | #FCF0D7              | #3B3222               |
| Practice text / surface         | #43536A / #E9EDF2    | #C4CFDF / #333A45     |
| Incorrect / destructive text    | #B32E29              | #FFA59A               |
| Destructive action / text       | #B32E29 / #FFFFFF    | #A92B27 / #FFFFFF     |
| Correct quiz answer             | #17623B              | #8CDDB0               |
| Modal scrim                     | rgb(20 24 30 / 35%)  | rgb(0 0 0 / 55%)      |
| Floating shadow color           | rgb(20 24 30 / 16%)  | rgb(0 0 0 / 30%)      |

Cobalt identifies actions, links, focus and active navigation. Amber is the single warm accent,
used for real deadlines. Practice, correctness and destructive roles convey content or state;
labels and icons repeat their meaning. Syntax uses primary for tags/keywords, correct-answer ink
for strings, supporting ink for comments and amber for numbers. The shadcn accent token means
selection, not a second brand accent. Secondary buttons use card/foreground. Chart tokens reuse
existing roles. Long-form ink mixes 75% foreground and 25% supporting ink.
Content cards use muted fill by default, selection fill for learning resources and a quiet blue-gray
practice fill for exercises. Hover and keyboard focus mix 8% semantic ink into that fill; pressing mixes 10%.

## Typography and writing

- Bundled **Inter Variable** throughout; existing system monospace only for code and commands.
  No additional font dependency.
- Sizes: page titles 32px (28px below 48rem), sections 24px, panels/results 20px, body/items 16px,
  labels/supporting text 14px, captions/table headings 12px. Correction titles retain 20px,
  growing to 24px at 40rem. The Campus wordmark uses 24px, weight 600 in both spaces.
- Weights: 400 prose, 500 labels, 600 headings/emphasis. Heading tracking between -0.035em and 0;
  body line height 1.55, reading text 1.65, maximum measure 75ch. Scores use tabular figures.
- French interface, **vous** in instructions; personal actions may use “Me connecter” or “Mon atelier”.
  Name the task, object and consequence. Prefer one short sentence per instruction.
- No “Transformez votre business”, “Libérez votre potentiel”, “La solution tout-en-un”, “Boostez”,
  “révolutionnaire”, “sans effort”, adjective triplets or em-dash punctuation. Use a middle dot
  in page titles and a colon within a label. Preserve authored course wording and line breaks.
- Missing results use “N/D” in compact tables and remain distinct from zero; unentered points
  remain blank. Preserve precise save, validation and conflict messages.
- Legal unknowns are explicitly labelled [À COMPLÉTER]; never infer a legal basis or provider fact.

## Shapes, spacing and controls

- **One 8px radius** for controls, badges, avatars, cards and overlays. Legacy radius names alias
  it. Filled work surfaces have no decorative border; nested surfaces use the existing card,
  muted or semantic fills. Table joins and edge-to-edge rows stay square inside their rounded
  container; circles inside icons/calendar dots are geometry. Keep essential control boundaries.
- **4px spacing grid:** 4, 8, 12, 16, 20, 24, 32, 40px. Spacing expresses proximity rather
  than applying the same margin everywhere: compact metadata uses 4px; title/description and
  label/control pairs use 8px; small action groups use 8–12px; related content and its next action
  use 16px; fields and subgroups use 24px. Major sections, including the gap after a page heading,
  use 32px, increasing to 40px from 40rem. Reuse `--space-label`, `--space-content`,
  `--space-fields`, `--space-groups`, `--space-sections` and their layout utilities. Filled work
  surfaces use `--surface-padding`: 20px, increasing to 32px from 48rem. Compact rails, tables
  and correction panels retain their task-specific density. Borders 1px; keyboard focus 2px.
- One cobalt primary button, one bordered secondary button. Outline and secondary variants share
  the latter. Quiet icon controls/text links remain quiet; destructive variants retain their
  semantic color. No pill controls. Long labels wrap.
- Touch targets at least 44px; narrow/coarse-pointer fields use at least 16px text and 44px height.
  Desktop inputs retain 40px, or 32/36px in compact editors. Keep visible labels, descriptions and field errors.
  Toolbars align fields and buttons at 44px. Date/time fields must show their complete value;
  let their grid wrap before compressing native date controls. Textareas grow with their content.
  Checkbox marks occupy 20px with a 44px hit area; badges have at least 24px height and wrap.
- Flat persistent surfaces. Only floating content uses 0 12px 40px var(--shadow-color).
  Modal scrims dim without backdrop blur. Selection, caret, scrollbars and focus use palette tokens.
- Use spacing before separators. A group boundary has at most one divider; filled work surfaces
  do not need enclosing rules. Student complementary resources use space without dividers. Interactive
  state belongs to the actual target, not static headings.
- Main actions sit at the trailing edge of the content heading or selected context. Long forms
  repeat the same command in their existing bottom save bar, with one form and one pending state.
  Cancel precedes confirmation. Row actions end with edit then delete. Destructive page actions
  occupy a separate group; final destructive confirmations use the solid red button. Correction
  summaries, live-quiz controls, local item actions and dialog footers retain their task-specific positions.
  Row deletion uses the quiet destructive button: destructive ink, transparent rest state and
  a 10% destructive fill on hover. Dialog visual order follows DOM order on mobile and desktop.
  Editable fields darken their neutral border on pointer hover, retain cobalt keyboard focus and
  use full destructive ink for errors in both themes. Read-only fields use the muted fill.
  Compact module creation keeps its single action directly after its short set of fields.

## Icons, identity and metadata

- **Lucide**, 16px and 2px stroke throughout interface controls and content. No emoji icons.
  Student course section headings repeat their navigation icon, size and primary ink. Their
  20px headings use a 12px icon gap and 20px before content across all course views.
  Existing Codex/Claude marks identify real integrations and retain their licenses.
- Campus wordmark and a simple cobalt **C** monogram. SVG favicon; 16/32/48px PNGs and ICO fallback;
  180px Apple touch icon, 192/512px app PNGs. Raster assets derive from the same vector.
  The teacher navigation's Campus wordmark pairs its 24px text with a 24px book icon.
  Run `pnpm assets:identity` after changing palette tokens to refresh the SVG colors and raster assets.
- Open Graph: 1200 × 630, warm background, Campus wordmark, “Préparer, évaluer, partager les cours.”
  No photo, testimonial, metric or private record. All assets stay local.
- Each page has a useful title and description. Private share cards stay generic; only published
  class/course titles and descriptions may personalize public cards. Preserve noindex/no-store.
  Resolve assets against the deployment origin, including the chosen workers.dev address.

## Motion

Only useful feedback: color/opacity at **140ms**, panels/overlays at **220ms**, using
cubic-bezier(0.22, 1, 0.36, 1). Panels fade without vertical travel. Commands may depress 1px;
menu triggers do not. Sheet movement and disclosure chevrons communicate opening/closing.
Internal content cards have no directional chevron. External-link symbols stay beside their
content, without a dedicated footer or directional movement. Disclosure and return icons remain.
Spinners/pulses run only while loading. No scroll entrance, parallax, bounce, custom cursor or
route snapshots. Reduced motion removes animation/transition duration. Focus and actions never
wait; motion never remounts an editor or resets a draft.

## Approved compositions

Keep existing layouts and the product/access/grading contracts in PRODUCT.md and AGENTS.md.

- **Teacher shell:** persistent collapsible 13.5rem rail; 100rem work-region cap; horizontal padding
  16/28/40px. Below 48rem use the compact header and navigation sheet. Preserve skip links, measured
  headers, contextual quiz header and the reserved loading slot. Below 40rem, show the parent
  return as a 44px icon button with its accessible label retained, leaving room for the page title.
- **Home/library:** next lesson beside calendar, compact empty state, actual drafts; preserve
  calendar URL state. Module library uses searchable divided rows and precise task links;
  module titles are static. Mobile rows show three equal task actions with icons and visible labels.
  Published-page lists share the library's available width, row spacing and interaction grammar.
- **Empty states:** distinguish first use from an empty search or missing selection. Name the
  missing content and the next available action; do not offer a selection from an empty list.
  Keep one primary creation action, and hide empty selectors and section indexes until they are
  useful. When a directory is absent, its content spans the available work area. Reuse the shared
  Empty composition. Empty states align with the logical start of the surrounding reading area,
  never as centered welcome panels. Keep the title, explanation and action together in a compact
  vertical group, with a prose-width text measure and natural line wrapping. They do not expand
  to fill spare height. Standalone empty workspaces use `Empty.Root` with `variant="surface"`,
  matching the first-class panel: card background, shared radius, `--surface-padding` and a
  relevant Lucide icon in `Empty.Media`. Keep text and actions aligned to the logical start.
  The default plain variant has no fill or padding and serves messages inside existing surfaces.
  The surface's outer edge follows the page reading edge. Empty content nested inside a padded
  work surface uses a compact 16px inset when it has its own fill. Existing filled work surfaces
  own their padding and radius; avoid duplicated padding and decorative dashed borders.
  Keep an empty state's explanation and next action 16px apart; empty validation containers
  must not introduce an extra layout gap.
- **Preparation/navigation:** 13rem task rail from 64rem, labelled native selector below. Preserve
  the four preparation sections, private-reference disclosure and manual tab activation.
  Module destinations stay Préparer, Quiz, Barème, Notation, Publication, with desktop links/mobile
  bottom sheet, retained class/context/year/section, and existing dirty-navigation guards.
  Lesson forms place title/start/end in the first row and recap/to-do in the second row, with
  a single-column fallback. Removal belongs to the lesson heading, not a separate empty row.
- **Classes/annual:** daily class choices contain only the current Paris academic year, starting
  on September 1. Creation assigns that year automatically; labels say “Classe”, without a year
  selector or repeated year suffix. A sole module class is static context, not a selection control.
  Keep the year explicit in annual management, historical reading and export/purge confirmation.
  Historical module baselines remain intact when reusable teaching content is edited.
  Keep reviewed annual choices, actual counts and receipts.
  The annual-management entry stays neutral; preparing permanent closure and confirming deletion
  use destructive treatment. Roster rows expose edit and delete directly, with deletion confirmation.
- **Grading:** preserve rubric-table, grid-split, correction-bottom-summary, visible desktop
  context/summary and internal history scrolling. Separate roster and student summary by 24px.
  The rubric uses a 13rem section index beside expanded criterion entry from 58rem container width,
  and a labelled native section selector below. Index choices are 44px with a 20rem vertical scroll
  cap only for long lists; no horizontal overflow or clipped focus. Calculations and deadlines follow
  the entry surface, without the intermediate three-link navigation. Fieldset legends sit inside
  their surface; the outer surface owns background and padding.
  Keep pdf-inline before filters, complete-class export and Enregistré / Proposé / Retenu review.
- **Publication:** preserve publish-sections, shared reviewed preview, scope/decision rail from
  64rem, internal desktop preview scrolling and mobile section sheet. Keep conflict drafts intact.
  Publication uses one publish command beside the class selector, without a duplicate decision
  panel in the rail. Refresh is secondary; unpublish remains a separate destructive action in the rail.
- **Public reading:** neutral header, flexible main and footer fill the viewport. Class search and
  divided modules share one work surface. Course pages retain 13rem rail from 64rem, section bottom
  sheet below, focus restoration and shared teacher preview. Preview omits public returns/footer.
  Keep expanded instructions, objectives, blank-rubric disclosures, deadlines and exercise/session
  detail. ContentCard retains neutral/learning/practice roles; external links announce a new tab.
  Session and dossier cards share a height across their respective grids, with titles wrapping at
  the top. Session numbers and dates sit at the bottom and stack on narrow cards. Dossier criteria
  counts, totals and deadlines sit at the bottom as well. Keep the session icon in the section
  heading. Filled cards expose hover, active and full-card keyboard focus.
  CodeBlock remains keyboard-scrollable; revealing a correction is an ordinary action.
  Course materials use a paginated catalogue of up to six rows with 48px minimum targets and shared
  dividers. Documents lead and open directly. Workshops follow semester and scheduled lesson
  order, with the lesson title and date under each title when linked. Search matches titles and
  lesson names regardless of case or accents, and combines with a native scope for available
  types, semesters and lessons. Search and scope reset pagination. Returning from a workshop
  restores the query, scope, page and focus. The assignment index opens each dossier at its
  heading and restores focus to its card on return. A dossier links to its instructions, blank
  rubric, deadline and files whenever they are available. The complementary resource index also
  lists each associated instruction, rubric and resource link once. An exercise with a correction
  uses horizontally aligned Énoncé and Corrigé tabs. An exercise with only a statement opens
  directly in reading mode.
  Module, project and dossier instructions, exercise statements and corrections share a Markdown
  reader with a 75ch reading measure, semantic headings and tables, HTTPS links, lists, bold text
  and inline code. Wider tables scroll within their own keyboard-accessible region. Fenced code retains
  its whitespace, language label and syntax colors; HTML remains literal text. Supplemental
  correction code uses the same labelled block with a separate 16px gap.
  Exercise code blocks place the language on the left and an always-visible, icon-only copy
  button on the right, with a 44px target and an accessible French name. Copy preserves the raw
  source, including whitespace, without the language label. A check icon and polite announcement
  confirm success for two seconds; failure selects the code and explains how to copy it manually.
  Partial text selection and horizontal keyboard scrolling remain available. Bash, sh and shell
  blocks highlight commands, strings, comments and variables; Svelte blocks also highlight runes.
- **Access/applications:** compact passkey card and separate activation help. Preserve native
  profile/consent/revocation forms, grouped requested permissions, real authorization state,
  clipboard fallback and conflict recovery. Keep technical identifiers out of consent.
  Account routes share one persistent shell with two views: personal information/access, and
  connected applications (calendar and MCP). Keep existing URLs and native form actions. Protect
  unsaved profile and calendar input when changing views; retain route titles and active navigation.
- **Legal:** existing public shell, 70ch article, collapsed native contents with 44px links,
  divided definitions and readable cookie inventory. Footer appears on public courses/legal/error
  pages; private workspaces, access and fatal fallback keep their established shell. Keep truthful
  disclosures of connected AI tools and data processing.
- **Quizzes:** keep visible library actions, contextual drawers, explicit saves/frozen state,
  eligible-student selection with loading/error/empty states, and factual incident wording.
  Library actions keep their column positions across quiz states. On narrow screens, the
  room or results action sits on a second line within the same cell.
  Wide monitoring retains its nonmodal 24rem inspector below the measured header; mobile uses a
  modal sheet. Preserve student timer/save status, fullscreen fallback, question navigation,
  pre-submission summary and confirmed submission after acknowledged saves.
- **Personal review:** retain 15-minute expiry, one open correction, two-column option order,
  mobile icon placement, text/icon feedback, focus/visibility/print hiding and clearing private
  state before full-page return. Never claim screenshot prevention.
- **Forms/time:** preserve Formsnap/Superforms, integer entry, blank versus zero, explicit saves,
  independent comments, HTTP 409 drafts, field-error focus and action toasts. Save bars stay in
  flow on narrow/coarse-pointer layouts; keep safe areas. Preserve French/Paris dates, seconds
  through 60 seconds and existing quiz-duration steps/bounds.

## Verification

Use fictional fixtures to check both themes, 320px/mobile/desktop, long content, keyboard focus,
reduced motion and loading/empty/error states. Text/placeholders target 4.5:1; large text and
essential control boundaries 3:1. No private records in captures or assets. Production HTTPS,
passkeys and external resources require separate acceptance; local checks do not certify them.
