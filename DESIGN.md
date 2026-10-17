---
name: Coursely
description: 'The implemented neutral shadcn-svelte luma workspace for teaching preparation.'
colors:
  'primary': 'oklch(0.205 0 0)'
  'primary-foreground': 'oklch(0.985 0 0)'
  'background': 'oklch(1 0 0)'
  'foreground': 'oklch(0.145 0 0)'
  'muted': 'oklch(0.97 0 0)'
  'muted-foreground': 'oklch(0.5 0 0)'
  'border': 'oklch(0.922 0 0)'
  'input': 'oklch(0.922 0 0)'
  'ring': 'oklch(0.145 0 0)'
  'control-border': 'oklch(0.5 0 0)'
  'sidebar': 'oklch(0.985 0 0)'
  'sidebar-accent': 'oklch(0.97 0 0)'
  'destructive': 'oklch(0.577 0.245 27.325)'
typography:
  headline:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '2.25rem'
    fontWeight: 600
    lineHeight: '2.5rem'
    letterSpacing: '-0.025em'
  headline-compact:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '1.875rem'
    fontWeight: 600
    lineHeight: '2.25rem'
    letterSpacing: '-0.025em'
  title:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '1.875rem'
    fontWeight: 600
    lineHeight: '2.25rem'
    letterSpacing: '-0.025em'
  title-compact:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '1.5rem'
    fontWeight: 600
    lineHeight: '2rem'
    letterSpacing: '-0.025em'
  section:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '1.25rem'
    fontWeight: 600
    lineHeight: '1.75rem'
    letterSpacing: '-0.025em'
  body:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: '1.5rem'
  body-small:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.875rem'
    fontWeight: 400
    lineHeight: '1.25rem'
  label:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.875rem'
    fontWeight: 500
    lineHeight: '1.25rem'
  caption:
    fontFamily: "'Inter Variable', sans-serif"
    fontSize: '0.75rem'
    fontWeight: 400
    lineHeight: '1rem'
rounded:
  'lg': '0.625rem'
  'xl': '0.875rem'
  '2xl': '1.125rem'
  '3xl': '1.375rem'
  '4xl': '1.625rem'
  'full': '9999px'
spacing:
  '1': '0.25rem'
  '2': '0.5rem'
  '3': '0.75rem'
  '4': '1rem'
  '5': '1.25rem'
  '6': '1.5rem'
  '7': '1.75rem'
  '8': '2rem'
  '9': '2.25rem'
  '10': '2.5rem'
  '12': '3rem'
components:
  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.4xl}'
    padding: '0 0.75rem'
    height: '2.75rem'
  button-outline:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.4xl}'
    padding: '0 0.75rem'
    height: '2.75rem'
  button-ghost:
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.4xl}'
    padding: '0 0.75rem'
    height: '2.75rem'
  button-link:
    textColor: '{colors.primary}'
    typography: '{typography.label}'
    rounded: '{rounded.4xl}'
    padding: '0 0.75rem'
    height: '2.75rem'
  input-text:
    backgroundColor: 'color-mix(in oklab, oklch(0.922 0 0) 50%, transparent)'
    textColor: '{colors.foreground}'
    typography: '{typography.body-small}'
    rounded: '{rounded.lg}'
    padding: '0.25rem 0.75rem'
    height: '2.5rem; 2.75rem for coarse pointers'
  input-compact:
    rounded: '{rounded.lg}'
    padding: '0.25rem 0.5rem'
    height: '2rem; 2.75rem for coarse pointers'
  navigation-item:
    textColor: '{colors.foreground}'
    typography: '{typography.body-small}'
    rounded: '{rounded.xl}'
    padding: '0.5rem 0.75rem'
    height: '2.75rem'
  badge-outline:
    textColor: '{colors.foreground}'
    rounded: '{rounded.3xl}'
    padding: '0.125rem 0.5rem'
    height: '1.25rem'
  badge-secondary:
    backgroundColor: '{colors.muted}'
    textColor: '{colors.primary}'
    rounded: '{rounded.3xl}'
    padding: '0.125rem 0.5rem'
    height: '1.25rem'
  class-tab:
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.full}'
    padding: '0.25rem 0.75rem'
    height: '2.75rem'
  table-container:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.xl}'
    width: '100%'
  avatar-fallback:
    backgroundColor: '{colors.muted}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.full}'
    size: '2rem'
  sidebar-inset:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    rounded: '{rounded.2xl}'
    width: '100%'
  user-menu-trigger:
    backgroundColor: '{colors.sidebar}'
    textColor: '{colors.foreground}'
    typography: '{typography.label}'
    rounded: '{rounded.xl}'
    height: '3.5rem'
    width: '100%'
  theme-toggle:
    textColor: '{colors.foreground}'
    rounded: '{rounded.3xl}'
    height: '2.75rem'
    width: '100%'
  theme-toggle-selected:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.primary-foreground}'
  preview-sheet:
    backgroundColor: '{colors.background}'
    textColor: '{colors.foreground}'
    typography: '{typography.body-small}'
    width: '75%'
---

# Design System: Coursely

## Overview

**Creative North Star: "Neutral shadcn-svelte luma workspace"**

Coursely inherits its neutral shadcn-svelte luma foundation: a white work area, pale navigation, Inter and restrained Lucide line icons. The material is quiet and practical. Text, alignment, tonal state changes and consistent borders carry the hierarchy. This records the implemented system rather than introducing a new brand identity.

The interface has compact information rows and enough space around headings and actions to make daily work legible. Controls retain the luma library’s soft rounded shapes; text fields and native selects use 10px corners, while data containers use smaller corners and separators. Motion belongs to control state changes and opening or closing sheets. No bespoke logo or imagery has been approved; the product name is rendered as text.

**Key Characteristics:**

- White workspace with a pale neutral navigation surface.
- Inter hierarchy, sentence-case labels and restrained Lucide line icons.
- Rounded controls, bordered data containers and flat information rows.
- Responsive reflow, visible keyboard focus and reduced-motion support.

## Colors

The palette is achromatic except for destructive validation feedback. The frontmatter records the actual light-theme OKLCH values from `src/routes/layout.css`; descriptive names below explain their use rather than redefine them.

### Primary

- **Charcoal action** (`primary`): the filled preparation action, link buttons, text selection and input caret. Its near-white inverse (`primary-foreground`) keeps filled actions legible.

### Neutral

- **White workspace** (`background`): the main canvas, outlined controls, data container and preview sheets. The library’s card and popover tokens resolve to the same value in this light theme.
- **Near-black ink** (`foreground`): headings, navigation labels and data.
- **Pale navigation** (`sidebar`): the persistent navigation rail and mobile navigation sheet.
- **Soft state surface** (`muted`, `sidebar-accent`): tabs, active navigation, secondary badges and hover states. The secondary and accent primitives share this value.
- **Mid-gray supporting text** (`muted-foreground`): descriptions, dates, counts and supporting labels.
- **Fine divider** (`border`): table boundaries, preparation rows, header and sheet boundaries.
- **Input surface source** (`input`): mixed at half opacity for the softly filled text field.
- **Focus ink** (`ring`): the foreground alias used for solid keyboard outlines and focused field borders.
- **Control boundary** (`control-border`): the supporting-text alias used for text fields, text areas, native selects and unchecked checkboxes. Invalid fields retain their destructive boundary.
- **Validation red** (`destructive`): field error text, invalid border and invalid ring. It is a functional signal, not an additional brand accent.

**The Neutral State Rule.** Use the existing neutral tokens for navigation, filters and preparation states. Reserve the destructive color for invalid input; state labels must remain readable without color.

The sidebar footer offers Clair, Sombre and Système through a compact icon button and a shadcn-svelte radio menu. `mode-watcher` defaults to the system preference, remembers the chosen mode in this browser and follows operating-system changes while Système is selected. Semantic tokens provide the same neutral hierarchy in both themes. Unused chart colors are not promoted into this system.

The dark theme uses these existing overrides from `src/routes/layout.css`; component references keep their semantic names:

| Token                | Dark value                  |
| -------------------- | --------------------------- |
| `primary`            | `oklch(0.922 0 0)`          |
| `primary-foreground` | `oklch(0.205 0 0)`          |
| `background`         | `oklch(0.145 0 0)`          |
| `foreground`         | `oklch(0.985 0 0)`          |
| `muted`              | `oklch(0.269 0 0)`          |
| `muted-foreground`   | `oklch(0.708 0 0)`          |
| `border`             | `oklch(1 0 0 / 10%)`        |
| `input`              | `oklch(1 0 0 / 15%)`        |
| `ring`               | `oklch(0.985 0 0)`          |
| `control-border`     | `oklch(0.708 0 0)`          |
| `sidebar`            | `oklch(0.205 0 0)`          |
| `sidebar-accent`     | `oklch(0.269 0 0)`          |
| `destructive`        | `oklch(0.704 0.191 22.216)` |

The initial full review covered all 14 approved surface compositions and required F1–F4. After correction, an independent VERDICT PASS returned ship within the F1–F4 scope: all four findings resolved and no correction left open in that scope. It did not repeat the full audit. All 56 current captures were refreshed; the 112 cases at 320, 390, 768 and 1440px in light and dark recorded no horizontal overflow or page errors. Desktop and mobile dirty-navigation checks pass, as do lint, application/operator/browser type checks, the Workers build and 311 unit tests. Screen-reader, physical-device/software-keyboard, practical browser-zoom, real-passkey hardware and HTTPS acceptance remain outstanding; this is not WCAG certification.

## Typography

**Heading Font:** Inter Variable (with sans-serif fallback).
**Body Font:** Inter Variable (with sans-serif fallback).
**Label Font:** Inter Variable; no separate display or mono face is used.

**Character:** One restrained sans-serif family keeps preparation content, navigation and grade fields coherent. Semibold headings have slightly tight tracking; prose and labels stay in sentence case.

### Hierarchy

- **Headline:** the page heading uses `headline` from the small breakpoint upward and `headline-compact` below it.
- **Title:** the next module uses `title` from the small breakpoint upward and `title-compact` below it. Preview module titles keep the compact title role.
- **Section:** `section` marks a section such as the module list. Smaller subsection headings use the body size with semibold weight.
- **Body:** `body` is the regular prose and preview metadata role; `body-small` serves compact descriptions and data rows. Long descriptive blocks use relaxed line height (1.625) and the home’s introductory copy is limited to the inherited prose width (65ch).
- **Label:** `label` is the medium-weight control and table-header role.
- **Caption:** `caption` is the small supporting footer role. Badges use the same size with medium weight.

**The Single Family Rule.** Use Inter for headings, prose, labels and data. Establish hierarchy with the observed size, weight and spacing changes.

## Layout

The desktop shell follows the approved dashboard-01 arrangement using the existing luma system. A fixed 18rem sidebar surrounds a flexible `Sidebar.Inset` work area. From the medium breakpoint (48rem), the inset has a 0.5rem outer margin, no left margin while navigation is expanded, `2xl` corners and the library’s small shadow. When the offcanvas sidebar closes completely, the inset also gains the left margin and takes the available width. The page has one main landmark, with the existing centered content capped at 72rem. The header is 3rem high and its toggle is 44px square. The spacing unit remains 0.25rem.

Horizontal main padding remains 1.25rem by default, 2rem at the small breakpoint (40rem), and 3rem at the extra-large breakpoint (80rem). Header padding is 1rem, becoming 1.5rem at the large breakpoint (64rem). The page starts with 2.25rem top padding, becoming 2.5rem at the small breakpoint. Sections use 2.25–2.5rem vertical spacing; row-level gaps are tighter. The class controls and actions wrap naturally when space is limited.

The navigation becomes a left sheet below the medium breakpoint (48rem), with a trigger in the header and a width of 18rem. The teacher home pairs the next intervention with a visual lesson month from the extra-large breakpoint (80rem), using a 1.35fr to 1fr grid with a 2.5rem gap. Below it the month is a closed disclosure and the next intervention remains first. The module table appears from the large breakpoint (64rem); narrower views use divided rows with the module, linked classes and preparation action. These are the approved home arrangements; each other surface keeps its own composition brief.

Preview sheets occupy 75% of the viewport width, with a maximum width of 24rem (384px) from the small breakpoint (40rem / 640px) upward. The side-specific library selectors determine these rendered dimensions despite the broader caller width classes. Content scrolls within the sheet; header, content and footer use 1.5rem padding. The body supports widths from 320px, and sheets honor top and bottom safe-area insets.

The grading context selectors stack below 64rem to keep module and class names readable beside the sidebar. Detailed correction keeps score fields and their internal keyboard focus visible at the scroll edges. Criterion rows use 0.5rem vertical and 0.75rem horizontal padding; score fields use compact density on fine pointers. Its bounded desktop composition (at least 80rem wide and 36rem high) counts the inset's bottom margin once and uses a document-relative top offset; the context and summary stay visible while the criterion list scrolls internally as needed. Shorter work regions scroll internally while retaining the summary actions. These refinements preserve the palette, type scale, corner tokens and 44px touch target floor.

Correction and proposal review keep their context and bottom summary outside the scrolling work body in that bounded desktop region. History, diagnostics and auxiliary panels remain reachable within it. At widths up to 63.99rem, criterion lists return to visible overflow and the document provides the reading flow. Summary issue counts stay concise; full calculation diagnostics belong in the work body.

Shared module and rubric save bars follow the last field. On desktop they stick to the bottom of their editor; at widths up to 63.99rem or with a coarse pointer they stay in normal document flow. Their padding includes the bottom safe area. Fine-pointer layouts from 64rem reserve 8rem of scroll padding and field scroll margin so a focused field can clear the action bar.

The student course and teacher publication preview use the same container-responsive renderer. Its five tabs become one row and its project references become an adjacent column when the renderer itself reaches 64rem, independently of the viewport or sidebar. Below that width the tabs use two columns with the last tab spanning both, and project references follow the active panel. The short deadline reminder precedes the tabs in both audiences.

**The Reflow Rule.** When the available width narrows, stack the content and retain explicit field labels. The current module table becomes labeled rows rather than a horizontally clipped table.

## Elevation & Depth

The navigation and module table remain flat at rest. The outer desktop inset uses the library’s small shadow to frame the work area; it does not introduce raised cards within the content. Fine borders and pale fills establish separation. Sheets and the account dropdown use a large soft shadow. Sheets also have a black backdrop at 30% opacity; supported browsers blur that backdrop by 8px. No independent decorative shadow is used on the teacher-home content.

### Shadow Vocabulary

- **Sheet elevation:** `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`, inherited from the installed Tailwind extra-large shadow.
- **Control focus:** pointer and touch do not add an outer frame or shadow. Keyboard buttons and links use one 2px inset outline in their text color; text fields and native selects use their existing border in the ring color. Invalid borders keep the destructive token. Primitive and forms-plugin rings are cancelled.

**The Flat Workspace Rule.** Use borders and pale surface changes to separate the working content. Use the small shadow only on the desktop application inset and the substantial shadow on overlays; dimmed backdrops belong to sheets.

## Shapes

The base radius is 0.625rem. The reused luma corner scale is recorded in the frontmatter: table containers and navigation items use `xl`, text inputs and badges use `3xl`, and buttons use `4xl`. Tab lists and triggers use fully rounded ends. Empty-state containers use `2xl` with a dashed boundary. Dividers and exposed row lists stay straight.

Borders are thin (1px). Sheets are rectangular edge-attached surfaces; a rounded card silhouette is not applied to them. Compact badges and full-size controls can share a radius token without sharing a height.

## Components

### Buttons

Calm rounded actions with a clear filled primary and quiet alternatives.

- **Primary:** charcoal fill and inverse text. The default size has horizontal padding of 0.75rem; the large home action uses 1rem. An end icon reduces its side padding to 0.75rem.
- **Outline:** white fill, divider-colored border and ink text; the hover and expanded state use the soft state surface.
- **Ghost:** transparent at rest; a soft state surface appears on hover or expansion.
- **Link:** charcoal text with underline on hover. Module-name links remove their horizontal padding to align with row text.
- **States:** keyboard focus uses an internal outline or the field border; active non-popup buttons move down 1px. Disabled controls have 50% opacity and no pointer interaction. State transitions use the library’s 150ms standard easing.

### Badges

Small non-interactive status labels (1.25rem high), with a medium-weight caption and optional small Lucide icon (0.75rem). Outlined labels indicate states such as valid or published; secondary labels use the soft state surface for states such as pending publication. Text carries the meaning. Ordinary metadata uses a label above its value, with a tighter gap inside the pair. Counts, school years, file formats and calculation totals use plain text or semantic outputs instead of badges. An associated class is a fieldset legend followed by the class/year value; only an unsaved association retains an “À enregistrer” badge.

### Cards / Containers

The existing data container is the bordered module table rather than a stack of standalone cards. It uses white fill, `xl` corners, clipped overflow, a 1px outline and no shadow. Header rows are 3rem high. Cells use 0.75rem padding, with 1.25rem on the table’s outer edges. Data rows contain 44px actions and change to a half-opacity muted fill on hover. The narrow module list uses top, bottom and row dividers with 1.25rem vertical row padding.

### Inputs / Fields

Softly filled fields use the input token at 50% opacity, `lg` corners (10px) and 0.25rem by 0.75rem padding. Their visible boundary uses `control-border`; focused valid fields use `ring`, while invalid fields retain `destructive`. Ordinary fields are 40px high, with a 32px compact variant for scoring and dense rubric rows. Coarse-pointer fields retain a 44px minimum. Input text is 1rem below the medium breakpoint and 0.875rem above it; coarse-pointer devices keep 1rem text. Placeholder text uses supporting gray.

Keyboard focus changes the existing field border; buttons and links use one internal 2px outline in their text color. Pointer and touch do not add an outer frame, and component/forms-plugin rings are cancelled. Invalid inputs retain a destructive border and a French message connected to the field. Disabled inputs have 50% opacity. Grading uses integer fields with maximums or ranges in the associated Formsnap description. An empty score remains distinct from zero; absence disables scoring without erasing raw points. The four assessment statuses retain their explicit text labels.

Formsnap Fieldset groups use a single flex gap, defaulting to 0.5rem. Callers can replace it with the existing 1.5rem or 2rem spacing without cumulative child margins; ordinary Field and ElementField spacing remains unchanged. Student-roster action cells reserve 0.25rem around their 44px buttons, so keyboard rings stay clear of row dividers and clipped table corners. Compact rubric action cells reserve 56px and align controls along their lower edge when labels wrap.

Validation summaries name the field and move to its actual input, opening the module section when necessary. Labels, descriptions and field errors remain connected through Formsnap. Search result counts use a polite live status near the filtered list.

### Teaching Context and Saves

The module name remains above the changing work section. Where a class context is selected, its class and academic year accompany it; return links retain that context and their useful section. Publication, rubric and grading destinations stay separate from the explicit save action.

Creation and editing share four freely accessible sections: Informations, Préparation, Liens étudiants, and Classes et planning. Desktop section controls become a labeled native selector below 64rem. Creation hints belong only to the first draft. Private preparation and publishable lesson notes identify their audience at the field.

The shared save bar pairs a polite saved/unsaved/pending status with a scope-named action such as Créer le brouillon, Enregistrer le module or Enregistrer le barème. A failed save or HTTP 409 retains the draft; refresh and replacement require an explicit choice. Correction points and the private semester comment have separate saves. Proposal review keeps Enregistré / Proposé / Retenu labels and separate point/comment decisions; stale references block acceptance.

Class work keeps Étudiants and Modules associés shortcuts in narrow views. The two add-student triggers open the same editor, and closing it preserves its draft during the page visit. Modified class-details and module-attachment dialogs ask before abandoning their input. Their close actions retain French labels and restore focus.

Notation starts with a compact work-year selector, followed by class on the left and its modules on the right. A missing class disables and empties the module selector and hides previous results. Multiple open years require an explicit persistent choice, with no date-based or newest-year default. The grade-grid PDF action remains below class/module selectors and before search filters, naming the whole-class scope. The individual PDF action sits in the selected student's summary. The annual dossier separates history/PDF rows from conservation and reviewed decisions. Closure is manual without a date prerequisite; its existing confirmation includes the next year and one continue/pause choice per module. Continued links remain stable, paused modules stay private, and annual student records are removed only after confirmation. The current rubric is not presented as a frozen historical copy. Archived results remain read-only.

### Navigation

The pale rail uses text labels and 1rem Lucide icons with a 0.5rem gap. Items use `xl` corners, 0.5rem by 0.75rem padding and compact body text. The active item has a pale state fill and medium weight; hover and active press use the same tonal surface. Keyboard focus adds one solid outline without stacking the sidebar ring. On phones the same content opens in a labeled sheet; the sheet closes after a navigation choice, and its close target is at least 44px. The home’s Modules destination follows the module-list anchor. Coursely is a semibold text name, not a bespoke logo.

### User Avatar

The sidebar footer contains a full-width user-menu trigger: a circular 32px avatar, then the authenticated teacher name and teacher-space description on two lines, with a vertical ellipsis at the right. The home receives this name from the teacher session; its teaching and grading data remains fictional. The row uses a 0.5rem gap. The fallback and description reuse foreground through a local `--muted-foreground` override, retaining contrast on the sidebar’s hover surface without changing global colors. The avatar itself is non-interactive and hidden from assistive technology; the surrounding profile button has a French accessible name.

At most two uppercase initials come from the first and last whitespace-separated elements of the same displayed full name. Extra spaces are ignored, a one-element name produces one initial and an empty name produces `?`. Hyphenated names remain one element. There is no image.

The shadcn-svelte dropdown opens to the right on desktop and prefers the bottom on mobile, with automatic collision handling. It repeats the identity and marks Compte and Notifications as forthcoming, with both entries disabled. Se déconnecter signs out through the auth client and opens `/connexion`; during the request it is disabled and reads Déconnexion…. A failed request leaves the session view in place and shows a French retry alert in the sidebar footer. It has no billing item. Escape returns focus to the profile trigger; hiding navigation closes the portaled menu and restores focus to the header toggle when appropriate. The three theme controls stay directly below the profile trigger.

### Teacher Access

`TeacherAccess.svelte` serves `/connexion` and `/activation` within the approved vertical access family. A centered Coursely text wordmark sits above a column capped at 30rem (480px), without the authenticated sidebar. Activation presents a compact wrapping row of three ordered steps: Invitation, Clé and Accueil. The current step uses ink and semibold text with `aria-current="step"`. Invitation identity precedes the full-width key-creation action; the name and email come from the invitation API and remain read-only, and the 40px avatar reuses the sidebar initials helper. Returning teachers use the same column with one Me connecter action and visible recovery guidance below it.

The compact step row uses restrained 16px Lucide icons and a thin lower divider. Existing shadcn-svelte Button, Avatar, Alert, Skeleton and Spinner primitives carry the controls and feedback. French alerts update near the identity/action, and preparation, device confirmation and successful opening use a polite live status region. The passkey action remains disabled while preparation, a device request or opening is pending. Retryable failures retain an appropriate retry action; an invalid or expired invitation cannot proceed. Success opens `/` automatically without a further confirmation screen. The surface adds no new account type or access channel.

The page uses `min-height: 100svh`, natural scrolling and safe-area padding. The column keeps 1.25rem side gutters; names, email addresses and button labels wrap. This surface compacts at 600px wide or 760px high and below without changing the global spacing or breakpoint system. It adds no entrance animation. The earlier vertical-access review is retained in [the Teacher Access surface brief](.impeccable/surfaces/src-lib-components-auth-teacheraccess-svelte.md); its eleven captures and ship verdict predate the compact-step changes, and their UI auth responses were simulated. The current sign-in and activation contracts belong to the [14 October coherence plan](docs/plans/2026-10-14-design-coherence.md), with supplied evidence in `.impeccable/review/coherence-20261014/`. Current fictional-fixture checks use the real authentication routes and teacher guards with a local virtual WebAuthn passkey, without a production auth seam. The invitation fragment is removed through the resolved activation route with a fixed-path fallback. Real passkey, HTTPS, physical-device, VoiceOver and Lighthouse acceptance remains outstanding.

### Class Tabs

The class filter is a muted fully rounded track with 0.25rem padding. Each 44px trigger has 0.75rem horizontal padding. The selected tab is white with ink text; unselected tabs use ink at 60% opacity. Hover strengthens the text and keyboard focus adds one solid outline without an additional ring.

Tab tracks use natural height rather than a fixed 36px box: the default 0.25rem padding surrounds the 44px triggers, while explicitly unpadded work-area tabs remain 44px tall. Wrapping keeps the same control height.

### Theme Toggle

The sidebar footer and public header use a compact ghost icon button with a named menu for Clair, Sombre and Système. The sun or moon reflects the effective mode. The button is 32px on fine pointers and at least 44px on coarse pointers. Menu radio items keep French accessible names, one checked preference, keyboard navigation and a visible indicator. mode-watcher still owns persistence and system preference tracking.

### Lesson Calendar

The teacher-home month is a visual reference for already planned lessons. It uses the existing shadcn-svelte Calendar in read-only mode without month navigation or date selection, French labels, a Monday first day and Europe/Paris dates. A small ink dot marks a lesson day; its accessible date also says séance planifiée and the legend explains the dot. The month is closed by default below 80rem in a keyboard-operable disclosure. It is separate from editable planning and submission deadlines.

### Student Course and Publication Preview

The public class directory makes each course title an actionable link under the neutral class/year header. The shared course renderer presents a short Paris deadline reminder before Supports du cours, Consignes et barèmes, Échéances et remise, Ressources utiles, and Vu en cours / à faire. One panel is visible at a time. Project instructions and rubric links remain available beside or after it, and absent content uses an explicit empty state.

The teacher preview renders the exact validated public projection with the same header, deadline and five panels; review controls remain outside that content. Changes to module information are named in the review rather than marked with ambiguous checks. Public pages expose no roster, individual grade or private comment and add no student account. When a retained publication has no class directory, its class-return link is omitted. Selected Drive/external links remain external, with new-tab meaning in their accessible label.

### Preview Sheets

Preparation, student and grading previews use the same right-attached sheet. Its title and description identify the audience and demo status, while separators divide content and a top-right close control stays available. Escape closes the sheet and focus returns to its trigger through the installed dialog primitive. The standard opening and closing behavior combines a short fade and a 2.5rem directional slide; sheet transitions use 200ms ease-in-out, with a 100ms backdrop fade. No bespoke animation is introduced.

The skip link becomes visible on focus and targets the main content. All interaction motion and smooth scrolling collapse under the reduced-motion preference (0.01ms animation and transition duration; one animation iteration; automatic scroll behavior).

**The Touch Floor Rule.** Interactive buttons, navigation items, tabs and text inputs have a minimum height of 44px; informational badges remain compact. Tab tracks size naturally around those controls; clipped tables and score lists reserve space for the existing keyboard rings.

## Do's and Don'ts

### Do:

- **Do** use the existing semantic OKLCH tokens and the Inter hierarchy.
- **Do** preserve the 44px minimum touch target height, keyboard focus and reduced-motion behavior.
- **Do** pair preparation and validation states with explicit text, including French field errors.
- **Do** reflow dense data into labeled rows at narrow widths and keep sheets usable within safe areas.
- **Do** use the installed shadcn-svelte primitives and restrained Lucide SVG icons.
- **Do** use one gap for Fieldset groups, reserve focus clearance around table actions and scroll edges, and stack grading selectors when their context names would be truncated.
- **Do** keep context and return links readable, name each action by its save or decision scope, and retain drafts on errors and conflicts.
- **Do** keep save actions in document flow on narrow or coarse-pointer layouts and reserve focus clearance on desktop.
- **Do** identify private and publishable content at the relevant field and use the shared public renderer for publication review.

### Don't:

- **Don't** introduce a bespoke logo, raster artwork or marketing identity without approval.
- **Don't** turn a status badge into an action or rely on color alone to communicate a state.
- **Don't** replace the workspace’s flat borders with decorative card shadows.
- **Don't** add ornamental animation or override the reduced-motion preference.
- **Don't** describe a missing score as zero, combine point and comment decisions, or suggest that a filtered grade-grid PDF exports only visible students.
- **Don't** add AI terminology to the product’s task labels or invent a successful save, publication or access state.
