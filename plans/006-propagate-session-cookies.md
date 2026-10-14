# Plan 006: Keep browser cookie expiry aligned with server session renewal

> Preserve current eight-hour expiry/hourly renewal semantics; do not silently choose another
> lifetime policy. Run every gate. First run `git diff --stat e0adfff..HEAD -- src/hooks.server.ts src/lib/server/auth/auth.test.ts src/lib/server/teaching/publication-hooks.test.ts` and compare `plans/baseline.json`.
> Browser files from plan 004 are expected additions; inspect their completed state before extending.

## Status

- Priority: P1
- Effort: S–M, including time-controlled browser integration
- Risk: MED; preserve cookie attributes/encoding and current lifetime policy
- Depends on: `plans/004-repeatable-browser-tests.md`
- Category: bug
- Planned at: commit `e0adfff`, 2026-10-13, including uncommitted source
- Audit finding: 5

Execution reconciliation, 2026-10-14: plan 002 already changed `auth.test.ts` for expiring quota
buckets. That reviewed quota-only diff is expected; retain it unchanged while adding session
assertions. The original foundation hashes remain immutable. The hook and publication-hook test
still match the recorded foundation; browser files from 004 are expected reviewed additions.

Browser diagnostic reconciliation, 2026-10-14: both viewports stopped at raw cookie-string
equality, after same session/user/count and renewed database expiry had passed. Installed Better
Call 1.4.0 percent-encodes the signed value; Kit's cookie 2.0.1 parse/set codec can emit the same
decoded value with valid cookie-octet characters unescaped. Reviewer independently reproduced
raw inequality but identical decoded values and identical values from Better Call's auth parser
using a synthetic fixture string. This is a test representation mismatch, not a reason to alter
production encoding, attributes, session policy or the hook. Compare decoded credentials in
safe boolean assertions, retain identity/expiry/deletion checks, and assert private/no-store on
the existing browser data response. Run the affected desktop case first; only after it passes
resume mobile and all gates. Preserve failed evidence and the original 006 manifest. If it fails
again, STOP with its exact phase and diagnostics before another change.

## Why this matters

The server hook reads Better Auth sessions without requesting response headers. Better Auth
renews database expiry after updateAge, but its Set-Cookie result never reaches the browser.
The cookie therefore expires at its old deadline while the database session remains valid.
A local real-auth check confirmed database renewal and emitted cookies with `returnHeaders: true`.
Align both sides without changing who can authenticate or how long configured sessions last.

## Current state

`src/hooks.server.ts:19` reads only the response body:

```ts
const session = await withAuth((auth) => auth.api.getSession({ headers: event.request.headers }));
event.locals.user = session?.user ?? null;
event.locals.session = session?.session ?? null;
```

`src/lib/server/auth.ts:55` configures:

```ts
session: { expiresIn: 8 * 60 * 60, updateAge: 60 * 60, cookieCache: { enabled: false } }
```

Current runtime is rolling eight-hour expiry refreshed at hourly intervals, not an implemented
absolute eight-hour cap. Keep those approved installed settings. No law prescribes this exact
application session duration. An explicit request for absolute expiry would be a separate policy
change and should revise this plan rather than be mixed into the cookie fix.

The hook avoids auth hydration on `/classes` and `/modules` including errors. It initializes null
locals, handles unavailable auth as 503 state, and sets private/no-store on authenticated/private
responses. `src/lib/server/teaching/publication-hooks.test.ts` asserts public reads never call auth.
`src/lib/server/auth/auth.test.ts` uses real in-memory migrations and virtual cryptographic WebAuthn.

Installed SvelteKit 3 `Cookies` types expose `parse` for a single Set-Cookie header; their example:

```ts
for (const str of response.headers.getSetCookie()) {
	const { name, value, ...options } = cookies.parse(str);
	cookies.set(name, value, options);
}
```

Use this supported request-local API, preserving decoded values and all returned attributes.
Do not split comma-joined cookie strings: Expires values contain commas.

## Commands you will need

| Purpose         | Command                                                                                                                                             | Expected            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Targeted tests  | `pnpm test:unit --run src/lib/server/auth/session-hooks.test.ts src/lib/server/auth/auth.test.ts src/lib/server/teaching/publication-hooks.test.ts` | All pass            |
| Browser renewal | `pnpm test:browser --grep 'session renewal'`                                                                                                        | Desktop/mobile pass |
| Full gates      | `pnpm lint`, `pnpm check`, `pnpm check:browser`, `pnpm test`, `pnpm test:browser`, `pnpm build`                                                     | Exit 0              |

Use explicit-file formatting before gates; no dependencies or migration are needed. Read the
repository Better Auth integration/security skills. Use current installed API/types and the
[1.7.7 session documentation](https://better-auth.com/docs/concepts/session-management).

## Scope

In scope:

- `src/hooks.server.ts`
- `src/lib/server/auth/session-hooks.test.ts` (new)
- `src/lib/server/auth/auth.test.ts`, time-controlled renewal assertions only
- `src/lib/server/teaching/publication-hooks.test.ts`, regression assertions only
- `tests/browser/auth.spec.ts` and its existing test-side fixtures, from plan 004
- `scripts/browser-fixture.ts`, `tests/browser/fixtures.ts` and `tests/browser/support/process.ts`
  only for private IPC operations on the allocated fictional session's timestamps/revocation
- This plan's index row

Out of scope: auth configuration/plugins, cookie naming or SameSite policy, session table,
secrets, role permissions, login UI, production origin, cache enablement, public session reads,
passkey algorithms, agent keys and absolute-lifetime redesign.

## Git workflow

Preserve pending work and use GitButler for branch/commit mutations only when requested; start
with `but status`. No automatic commit/push/merge/snapshot application. An executor dispatch uses
an isolated checkout. Match repository TypeScript strictness, `.js` imports and Prettier style.

## Steps

### Step 1: Reproduce the paired DB/cookie renewal behavior

Extend the real in-memory auth test using its existing register helper. Move only the synthetic
session's timestamps into a state past updateAge and before expiry, or control time with `vi`.
Call `getSession({ headers, returnHeaders: true })` and assert an eight-hour Max-Age, later database
expiry and preserved identity. Test a call before updateAge and a truly expired session separately.
Never print session tokens, cookies, invitations or generated secrets.

Verify: targeted auth test passes and demonstrates the underlying library already emits the
required headers. Add a hook regression expecting propagation; it should fail against the old hook.

### Step 2: Forward returned cookies through the current request

Change the hook's withAuth call to request `returnHeaders: true`. Assign locals from its `response`
field, preserving null handling. Iterate `headers.getSetCookie()` and apply each parsed cookie
through `event.cookies.parse`/`event.cookies.set` before `resolve(event)`. Validate required parsed
name/value according to installed types. Use no global cookie store, no extra auth request and no
manual re-signing. Preserve deletion cookies as well as renewal cookies and do not modify attributes.

Keep all existing building/authRoute/studentRoute/hasSession guards. Auth endpoint handlers
already return their own cookies; this hook must not double-handle them. Do not add the global
sveltekitCookies plugin merely to avoid handling this one call: its scope would include operator
and test contexts without request events.

Verify: hook tests pass for renewal, multiple cookies, deletion, encoded token round-trip,
HttpOnly/SameSite/Secure/path/expiry and two independent request events. Public-hook tests still
prove auth was not called and no teacher state/cookie was emitted.

### Step 3: Check a real browser request renews the same session

Using plan 004's local fixture, activate/sign in with its virtual authenticator. Manipulate only
the fictional session timestamps via the test-side database fixture into renewal-eligible state.
Capture the prior browser cookie expiry, navigate to a private route, and assert the resulting
cookie has a later expiry while identity/session row count stay stable. Navigate again before
updateAge and assert no unnecessary renewal; expiry/revocation must still require signing in.
Do not shorten production auth settings to make a test faster or wait an actual hour.

Fixture session operations return only selected session/user IDs, counts and timestamps; never
return session tokens, cookies or passkey material over IPC. For assertions involving real
credential values, compare in memory and assert a boolean with a safe message, rather than
letting a failed equality/regex assertion print the cookie/header/token. Cookie attribute and
expiry assertions may print only their nonsensitive parsed metadata. If second-level cookie
expiry precision requires it, poll a bounded clock boundary before aging the database row; do
not forge the authentication value, alter production lifetimes or add an arbitrary long sleep.

The loopback fixture uses development cookies. Unit/real-auth tests separately verify Secure on
an HTTPS test origin; deployed HTTPS/physical-device acceptance remains outside this plan.

Verify: targeted browser test passes both viewports, then format changed files and run all gates.
Inspect responses for private/no-store and absence of serialized session tokens in page data.

## Test plan

Real-auth cases: before updateAge, at renewal, expired and revoked. Hook cases: forwarded renewal
and deletion attributes, multi-cookie/encoding handling, request isolation, auth-unavailable state
and public/error-route bypass. Browser case: actual page navigation moves cookie expiry with the
same database session and leaves the teacher signed in. Use the original auth/public-hook tests as
patterns; do not test only a mocked cookie string.

## Privacy and French/EU requirements

Keep the cookie strictly for authentication/security; add no tracking, profiling or persistent
browser copies. Such strictly necessary authentication traceurs can be exempt from consent under
French Loi Informatique et Libertés Article 82; exemption does not remove other RGPD obligations.
See [Article 82](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000037813978) and
[CNIL cookie guidance](https://www.cnil.fr/fr/cookies-et-autres-traceurs/que-dit-la-loi).
Do not introduce a consent banner for this technical cookie fix. Preserve HttpOnly/Secure/Strict,
request-local identity and no-store. No real account/session is required in verification.

## Done criteria

- [x] Eligible private reads renew both database expiry and the browser's same-session cookie.
- [x] Before-updateAge, expired and revoked sessions behave correctly.
- [x] Attributes, deletions and encoded values survive propagation without double encoding.
- [x] Public course/error reads never hydrate or emit teacher session state.
- [x] Unit/browser tests, types, lint and Workers build pass; scope/index reviewed.

## STOP conditions

Stop on unexplained drift, repeated verification failure, unavailable returnHeaders/cookie APIs,
cookies that require changed naming/security attributes, or evidence of an approved absolute
eight-hour policy contradicting the installed rolling configuration. Report the exact mismatch
without silently extending lifetime or disabling refresh. Never use a real session to reproduce.

## Maintenance notes

Reviewer checked the Workers API against the preserved `compatibility_date: 2026-10-11`.
Cloudflare documents `Headers.getSetCookie()` as enabled by default from 2023-03-01, so no
compatibility flag or runtime configuration change is required for this API.
See [Cloudflare compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#headers-supports-getsetcookie).

Any future server-side Better Auth API call emitting cookies needs this same request-local
propagation review. If a global cookie plugin is introduced later, prevent duplicate propagation
and preserve operator/test calls without request events. Keep expiry tests when upgrading Kit/Auth.
