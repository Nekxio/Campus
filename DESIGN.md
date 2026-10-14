---
name: Coursely
description: 'The implemented neutral shadcn-svelte luma workspace for teaching preparation.'
colors:
  'primary': 'oklch(0.205 0 0)'
  'primary-foreground': 'oklch(0.985 0 0)'
  'background': 'oklch(1 0 0)'
  'foreground': 'oklch(0.145 0 0)'
  'muted': 'oklch(0.97 0 0)'
  'muted-foreground': 'oklch(0.556 0 0)'
  'border': 'oklch(0.922 0 0)'
  'input': 'oklch(0.922 0 0)'
  'ring': 'oklch(0.708 0 0)'
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
    rounded: '{rounded.3xl}'
    padding: '0.25rem 0.75rem'
    height: '2.75rem'
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

The interface has compact information rows and enough space around headings and actions to make daily work legible. Controls retain the luma library’s soft rounded shapes; data containers use smaller corners and separators. Motion belongs to control state changes and opening or closing sheets. No bespoke logo or imagery has been approved; the product name is rendered as text.

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
- **Focus gray** (`ring`): keyboard border and ring feedback.
- **Validation red** (`destructive`): field error text, invalid border and invalid ring. It is a functional signal, not an additional brand accent.

**The Neutral State Rule.** Use the existing neutral tokens for navigation, filters and preparation states. Reserve the destructive color for invalid input; state labels must remain readable without color.

The sidebar footer offers Clair, Sombre and Système through a single-choice shadcn-svelte Toggle Group. `mode-watcher` defaults to the system preference, remembers the chosen mode in this browser and follows operating-system changes while Système is selected. Semantic tokens provide the same neutral hierarchy in both themes. Unused chart colors are not promoted into this system.

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
| `ring`               | `oklch(0.556 0 0)`          |
| `sidebar`            | `oklch(0.205 0 0)`          |
| `sidebar-accent`     | `oklch(0.269 0 0)`          |
| `destructive`        | `oklch(0.704 0.191 22.216)` |

Desktop, mobile navigation and grade-validation states have been checked in both themes. Real-device and screen-reader verification remains outstanding.

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

The navigation becomes a left sheet below the medium breakpoint (48rem), with a trigger in the header and a width of 18rem. At the large breakpoint (64rem), the next intervention and preparation use a two-column grid (1.2fr to 1fr) with a 2.5rem gap, left border and inset for preparation. Below it they stack with a 2rem gap. The module table appears at that same large breakpoint; narrower views use divided rows with class, material status, module name and a notes action. This is the current teacher-home composition, not a mandatory template for every future screen.

Preview sheets occupy 75% of the viewport width, with a maximum width of 24rem (384px) from the small breakpoint (40rem / 640px) upward. The side-specific library selectors determine these rendered dimensions despite the broader caller width classes. Content scrolls within the sheet; header, content and footer use 1.5rem padding. The body supports widths from 320px, and sheets honor top and bottom safe-area insets.

The grading context selectors stack below 64rem to keep module and class names readable beside the sidebar. Detailed correction reserves 0.25rem at the score list's scroll edges for its 3px focus ring. Its bounded desktop composition (at least 80rem wide and 36rem high) counts the inset's bottom margin once and uses a document-relative top offset; at 1440 × 900 the eight standard project criteria remain visible with the context and summary. Shorter work regions scroll internally while retaining the summary actions. These refinements preserve the palette, type scale, corner tokens and 44px control floor.

**The Reflow Rule.** When the available width narrows, stack the content and retain explicit field labels. The current module table becomes labeled rows rather than a horizontally clipped table.

## Elevation & Depth

The navigation and module table remain flat at rest. The outer desktop inset uses the library’s small shadow to frame the work area; it does not introduce raised cards within the content. Fine borders and pale fills establish separation. Sheets and the account dropdown use a large soft shadow. Sheets also have a black backdrop at 30% opacity; supported browsers blur that backdrop by 8px. No independent decorative shadow is used on the teacher-home content.

### Shadow Vocabulary

- **Sheet elevation:** `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`, inherited from the installed Tailwind extra-large shadow.
- **Control focus:** a 3px ring in the ring color at 30% opacity on buttons and inputs; tabs use 50%, and sidebar items use a 2px sidebar ring. These indicate focus rather than resting elevation.

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
- **States:** focus changes the border and shows the ring; active non-popup buttons move down 1px. Disabled controls have 50% opacity and no pointer interaction. State transitions use the library’s 150ms standard easing.

### Badges

Small non-interactive status labels (1.25rem high), with a medium-weight caption and optional small Lucide icon (0.75rem). Outlined labels indicate states such as valid or published; secondary labels use the soft state surface for states such as pending publication. Text carries the meaning.

### Cards / Containers

The existing data container is the bordered module table rather than a stack of standalone cards. It uses white fill, `xl` corners, clipped overflow, a 1px outline and no shadow. Header rows are 3rem high. Cells use 0.75rem padding, with 1.25rem on the table’s outer edges. Data rows contain 44px actions and change to a half-opacity muted fill on hover. The narrow module list uses top, bottom and row dividers with 1.25rem vertical row padding.

### Inputs / Fields

Softly filled fields use the input token at 50% opacity, `3xl` corners and 0.25rem by 0.75rem padding. They are at least 44px high. Input text is 1rem below the medium breakpoint and 0.875rem above it; coarse-pointer devices keep 1rem text. Placeholder text uses supporting gray.

Keyboard focus adds the ring and border change. Invalid inputs show a destructive border, 3px ring at 20% opacity and a French message connected to the field. Disabled inputs have 50% opacity. The grade preview uses numeric input mode with integer validation: an empty field remains ungraded, and an absent student’s field is disabled. These are demonstration states, not an absence scoring or persistence policy.

Formsnap Fieldset groups use a single flex gap, defaulting to 0.5rem. Callers can replace it with the existing 1.5rem or 2rem spacing without cumulative child margins; ordinary Field and ElementField spacing remains unchanged. Student-roster action cells reserve 0.25rem around their 44px buttons, so keyboard rings stay clear of row dividers and clipped table corners. Compact rubric action cells reserve 56px and align controls along their lower edge when labels wrap.

### Navigation

The pale rail uses text labels and 1rem Lucide icons with a 0.5rem gap. Items use `xl` corners, 0.5rem by 0.75rem padding and compact body text. The active item has a pale state fill and medium weight; hover and active press use the same tonal surface. Keyboard focus uses the 2px sidebar ring. On phones the same content opens in a labeled sheet; the sheet closes after a navigation choice. Coursely is a semibold text name, not a bespoke logo.

### User Avatar

The sidebar footer contains a full-width user-menu trigger: a circular 32px avatar, then the authenticated teacher name and teacher-space description on two lines, with a vertical ellipsis at the right. The home receives this name from the teacher session; its teaching and grading data remains fictional. The row uses a 0.5rem gap. The fallback and description reuse foreground through a local `--muted-foreground` override, retaining contrast on the sidebar’s hover surface without changing global colors. The avatar itself is non-interactive and hidden from assistive technology; the surrounding profile button has a French accessible name.

At most two uppercase initials come from the first and last whitespace-separated elements of the same displayed full name. Extra spaces are ignored, a one-element name produces one initial and an empty name produces `?`. Hyphenated names remain one element. There is no image.

The shadcn-svelte dropdown opens to the right on desktop and prefers the bottom on mobile, with automatic collision handling. It repeats the identity and marks Compte and Notifications as forthcoming, with both entries disabled. Se déconnecter signs out through the auth client and opens `/connexion`; during the request it is disabled and reads Déconnexion…. A failed request leaves the session view in place and shows a French retry alert in the sidebar footer. It has no billing item. Escape returns focus to the profile trigger; hiding navigation closes the portaled menu and restores focus to the header toggle when appropriate. The three theme controls stay directly below the profile trigger.

### Teacher Access

`TeacherAccess.svelte` serves `/connexion` and `/activation` with the approved `auth-vertical` composition. A centered Coursely text wordmark sits above a column capped at 30rem (480px), without the authenticated sidebar. Activation connects three ordered steps: the invitation identity, a full-width key-creation action and automatic arrival at teacher home. The name and email come from the invitation API and remain read-only; the 40px avatar reuses the same initials helper as the sidebar. Returning teachers use the same column with one Me connecter action.

The connected rail uses 32px circular markers, thin separators and the existing semantic tokens; only the ready key step receives the primary fill. Existing shadcn-svelte Button, Avatar, Alert, Separator, Skeleton and Spinner primitives carry the controls and feedback. French alerts update in place, and preparation, device confirmation and successful opening use a polite live status region. The passkey action remains disabled while preparation, a device request or opening is pending. Retryable failures retain an appropriate retry action; an invalid or expired invitation cannot proceed. Success opens `/` automatically without a further confirmation screen.

The page uses `min-height: 100svh`, natural scrolling and safe-area padding. The column keeps 1.25rem side gutters; names, email addresses and button labels wrap. This surface compacts at 600px wide or 760px high and below without changing the global spacing or breakpoint system. It adds no entrance animation. The selected direction and final local verification are in [the Teacher Access surface brief](.impeccable/surfaces/src-lib-components-auth-teacheraccess-svelte.md). The fresh full review returned ship for all eleven current captures after Inter loading was corrected in the temporary validation copy. The captures cover light and dark desktop and phone layouts with simulated UI auth responses; the invitation fragment is removed through the resolved activation route with a fixed-path fallback. Real passkey, HTTPS, physical-device, VoiceOver and Lighthouse acceptance remains outstanding.

### Class Tabs

The class filter is a muted fully rounded track with 0.25rem padding. Each 44px trigger has 0.75rem horizontal padding. The selected tab is white with ink text; unselected tabs use ink at 60% opacity. Hover strengthens the text and keyboard focus adds a 3px ring.

Tab tracks use natural height rather than a fixed 36px box: the default 0.25rem padding surrounds the 44px triggers, while explicitly unpadded work-area tabs remain 44px tall. Wrapping keeps the same control height.

### Theme Toggle

The sidebar footer places an outlined Toggle Group below the teacher-space description. Three equally sized icon controls use the existing Lucide sun, moon and monitor, with French accessible names and tooltip labels. The group fills the available width; each control is at least 44px high and wide. Outer corners use `3xl`, and a muted fill marks the selected mode. The installed primitive exposes a radio group and supports arrow-key focus, Space activation and visible focus. Exactly one mode stays selected, including when the selected control is clicked again.

### Preview Sheets

Preparation, student and grading previews use the same right-attached sheet. Its title and description identify the audience and demo status, while separators divide content and a top-right close control stays available. Escape closes the sheet and focus returns to its trigger through the installed dialog primitive. The standard opening and closing behavior combines a short fade and a 2.5rem directional slide; sheet transitions use 200ms ease-in-out, with a 100ms backdrop fade. No bespoke animation is introduced.

The skip link becomes visible on focus and targets the main content. All interaction motion and smooth scrolling collapse under the reduced-motion preference (0.01ms animation and transition duration; one animation iteration; automatic scroll behavior).

**The Touch Floor Rule.** Interactive buttons, navigation items, tabs and text inputs have a minimum height of 44px; informational badges remain compact.

## Do's and Don'ts

### Do:

- **Do** use the existing semantic OKLCH tokens and the Inter hierarchy.
- **Do** preserve the 44px minimum control height, keyboard focus and reduced-motion behavior.
- **Do** pair preparation and validation states with explicit text, including French field errors.
- **Do** reflow dense data into labeled rows at narrow widths and keep sheets usable within safe areas.
- **Do** use the installed shadcn-svelte primitives and restrained Lucide SVG icons.

### Don't:

- **Don't** introduce a bespoke logo, raster artwork or marketing identity without approval.
- **Don't** turn a status badge into an action or rely on color alone to communicate a state.
- **Don't** replace the workspace’s flat borders with decorative card shadows.
- **Don't** add ornamental animation or override the reduced-motion preference.
