# Coursely

SvelteKit 3 / Svelte 5 / TypeScript foundation with shadcn-svelte, Tailwind CSS 4 and Cloudflare
Workers. The active application is the public starter page. Database access, authentication and
the prototype's courses, classes and grades are not part of this branch.

## Getting Started

Use Node **26.11.1** (`.node-version`) and pnpm **12.11.2** (`packageManager`).
Dependency versions are resolved in `pnpm-lock.yaml`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The starter runs without database credentials or authentication secrets. Existing private local
files are ignored by Git and must not be committed.

## Development and Validation

```sh
pnpm lint
pnpm check
pnpm test
pnpm build
pnpm preview
```

`vite.config.ts` configures SvelteKit, Tailwind and the Cloudflare adapter. The separate
`vitest.config.ts` runs Node-based unit tests; the original greeting example is retained.
There are no authentication or database tests on the active branch.

Strict TypeScript mode is enabled. `checkJs` is disabled to prevent Wrangler-generated types
from importing and analyzing built JavaScript bundles in `.svelte-kit`. TypeScript checks the
application, and ESLint also checks JavaScript configuration files. `check` and `build`
automatically regenerate Workers types.

The existing pages, styles and shadcn-svelte utilities are preserved. Components use the `#lib`
aliases defined in `components.json`.

## Cloudflare

`wrangler.jsonc` uses the Workers adapter with `nodejs_compat`. `pnpm preview` runs the built
application locally on port 4173. No cloud deployment, Cloudflare Access/Zero Trust activation
or paid plan is performed by these local commands.

## AI Configuration

The project retains its Svelte and Playwright MCP configuration. Playwright is pinned to
`@playwright/mcp@0.0.83` and launched on demand through `pnpm dlx`; it does not require a
Playwright test dependency in this project. Context7 can be used when supplied by the agent host.

The `svelte-code-writer`, `svelte-core-bestpractices`, `shadcn-svelte`, Better Auth and other
existing skills are retained for future work. Skills load on demand and are managed by their
installers; their presence does not enable authentication or database access.

The official Svelte CLI is installed as a development dependency:

```sh
pnpm ai:svelte list-sections
pnpm ai:svelte get-documentation 'kit/hooks,kit/auth'
pnpm ai:svelte svelte-autofixer src/routes/+page.svelte
```

See `AGENTS.md` for conventions and checks. Browser artifacts in `.playwright-mcp/` are ignored.

## Preserved Database and Authentication Work

The unapplied GitButler branch `wip/database-auth` preserves the complete source state from
before extraction, including the shared foundation, Turso/libSQL, Drizzle schemas and migrations,
Better Auth invitation-only passkeys, operator commands and WebAuthn tests.

This is a GitButler stash, not an entry in `git stash list`. The current `chore/setup` branch and
the saved snapshot are alternatives; do not apply both together to restore the old workspace.

To reopen the saved work, first check for uncommitted changes and preserve them if needed, then:

```sh
but oplog snapshot -m "Before reopening database and authentication work"
but unapply chore/setup
but apply wip/database-auth
pnpm install --frozen-lockfile
```

To return to the current foundation, preserve any new work on the saved branch before switching:

```sh
but unapply wip/database-auth
but apply chore/setup
pnpm install --frozen-lockfile
```

Reintegrating the backend into a later version of the foundation requires a deliberate merge
and validation. Applying the saved branch alone restores its original source state; it does not
merge subsequent work automatically. The pre-extraction GitButler operation snapshot is
`6d5a4b484de940338204f9b0f208b10f1dec077c` and can restore the complete original GitButler state.
