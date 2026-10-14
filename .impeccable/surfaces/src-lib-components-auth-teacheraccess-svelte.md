---
version: 1
slug: 'src-lib-components-auth-teacheraccess-svelte'
primary_target: 'src/lib/components/auth/TeacherAccess.svelte'
related_targets: ['src/routes/connexion/+page.svelte', 'src/routes/activation/+page.svelte']
---

# Teacher access

Mode: Operate. Léo selected **Parcours vertical** on the Impeccable decision page
`fb59174e`, option `auth-vertical`, code-led, on 12 October 2026. The approved sketch is
`.impeccable/mocks/decision/auth-0598-vertical.html`. No generated comp exists.

Teacher-only passkey sign-in and single-use invitation activation. Activation shows the
validated name/email, creates a passkey and opens teacher home automatically. Sign-in has
one action. Include preparation, busy, cancelled, invalid/expired invitation, unavailable
service and unsupported-browser feedback. No passwords, email delivery, self-sign-up or
private navigation before authentication. Keep invitation tokens out of URL queries, logs
and displayed content. The current teacher home remains fictional and becomes protected.

## Direction contract

THESIS: A short vertical journey connects the invitation, the device-held key and arrival
at teacher home, without an extra wizard confirmation.

OWN-WORLD: Existing luma neutral surfaces, Inter, semantic light/dark tokens, restrained
Lucide icons, flat separators and rounded shadcn-svelte controls.

STORY: Verify the invited identity, request a passkey, then enter the teacher workspace.
Returning users request their existing key directly.

FIRST VIEWPORT: Centered Coursely wordmark above a narrow 480px column. Heading and brief
explanation precede a connected sequence: read-only invitation identity, a full-width key
button, then automatic arrival. On phones retain this order, allow scrolling and wrap
names/emails; never keep the sketch's fixed viewport height.

FORM: Vertical guided activation, grounded structure 5, surface seed `0598add3`. State
updates happen in place; no entrance choreography. The signature is the connected steps,
with the active key step carrying the primary action. Sign-in uses the same column and
one key action.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Verified outcome

Implemented `auth-vertical`, code-led, seed `0598add3`, preserving luma and Inter. The
fresh **FULL** finish review returned **ship** for all eleven current captures, with no
material fixes or further captures required. The pattern is recorded in `DESIGN.md` under
Teacher Access and in `.impeccable/design.json`; there is no generated image comp or
shipping raster artwork.

Activation keeps the ordered invitation → key → home sequence; sign-in has one action.
The invitation API supplies the read-only identity. French alerts and live progress update
in place, passkey and verification actions are disabled while pending, retryable failures
can be retried, and success opens `/`. The page scrolls naturally, honors safe areas and
wraps long identity/action text. Home displays the session name and initials, and the
account menu signs out to `/connexion`; teaching and grading data on home remains fictional.

Evidence: `.impeccable/review/auth-access/evidence.json` and the eleven reviewed filenames
listed in `.impeccable/design.json`. The required matrix was recaptured after a temporary
`node_modules` symlink caused a font HTTP 403 in the validation copy. That fixture issue
was corrected without a source design or token change. The recorded family is Inter
Variable; its Latin WOFF2 response returned HTTP 200 and 48,256 bytes. The read-only browser
scope did not expose the font registry, so no registry proof is claimed.

Reviewed layouts include 1440×1000 desktop in both themes, the light phone pair at its
measured 375×812 content size, dark phone layouts, complete phone captures and the
810×1223 light viewport. The light phone pair was initially mislabeled as 390×844; the
review matrix records 375×812 and no capture was rescaled. The current full expired-state
capture, `mobile-expired-dark-full.jpg`, comes from Chrome via CUA because the in-app
browser compositor omitted the unchanged heading. The other current captures come from
the Codex in-app browser. Older supplemental `mobile-dark.jpg`, `mobile-expired-dark.jpg`
and `mobile-long-identity-dark-bottom.jpg` are outside the latest required matrix.

Local UI checks used simulated auth responses only in a temporary copy: fragment removal,
pending/disabled requests, activation and sign-in success, cancellation then retry, expired
invitation refusal, preparation 503 then retry, a replacement invitation in the same
document, long names/emails, keyboard action/link traversal and sign-out. Fragment removal
uses SvelteKit 3 `goto(resolve('/activation'), { shallow: true, replace: true, state:
page.state })`, with `window.location.replace(resolve('/activation'))` as the fixed-route
fallback if routing fails; it does not mutate raw browser history.

Final checks passed lint, type checking with 0 errors and 0 warnings, 47 crypto/domain
tests and the Workers build. The final local Workers smoke checks returned 303 to
`/connexion` for anonymous home, 200 for sign-in, 401 with `no-store` for the session API
and 200 for the font asset. The stale-cookie sign-in fallback also returned 200.

Real Touch ID/passkey and stable HTTPS-origin acceptance, physical mobile and VoiceOver
checks remain outstanding. No Lighthouse or field Core Web Vitals result is claimed.
