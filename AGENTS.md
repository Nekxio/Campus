# Coursely

SvelteKit web project deployed on Cloudflare Workers. Follow the repository's foundation and conventions.

## Project Configuration

- **Language**: TypeScript
- **Package Manager**: pnpm
- **Add-ons**: prettier, eslint, vitest, tailwindcss, sveltekit-adapter, ai-tools
- **Stack**: Svelte 5, SvelteKit 3, TypeScript 6, Tailwind CSS 4, Vite 8
- **Runtime**: Node.js 26.11.1; pnpm 12.11.2 (`.node-version` and `packageManager`); resolved versions in `pnpm-lock.yaml`
- **Deployment**: Cloudflare Workers adapter; database and authentication work is preserved on the unapplied GitButler branch `wip/database-auth`

## Commands

| Action             | Command                                                                  |
| ------------------ | ------------------------------------------------------------------------ |
| Development        | `pnpm dev`                                                               |
| Formatting         | `pnpm format`; prefer `pnpm exec prettier --write` on changed files      |
| Lint               | `pnpm lint`                                                              |
| Types              | `pnpm check`                                                             |
| Tests              | `pnpm test`; targeted tests: `pnpm test:unit --run` with the test path   |
| Build              | `pnpm build`                                                             |
| Cloudflare types   | `pnpm gen`; required before check/build if types are missing or outdated |
| Cloudflare preview | `pnpm preview`                                                           |

The active branch has no database or authentication commands. Do not restore the deferred backend
or run migrations as part of an AI setup task.

## Architecture and Conventions

- SvelteKit 3 is configured in `vite.config.ts`; preserve the Cloudflare adapter and runes mode.
- Routes belong in `src/routes` and shared code in `src/lib`. Future server-only code belongs in `src/lib/server`.
- Preserve the `#lib`, `$app/env` and `$app/env/private` imports and the project's strict types.
- Keep secrets and DB access on the server. No DB access from the client.
- The active foundation has no database or authentication. Migrate backend code, courses, classes, grades or prototype screens only on explicit request.
- Preserve the tabs, single quotes, absence of trailing commas and line width of 100 defined by Prettier.
- Third-party skill examples must defer to the repository's actual stack and conventions.
- Skills, engines and lockfiles are managed by their installers: do not edit their internal files.

## Deferred Database and Authentication

- `wip/database-auth` is an unapplied GitButler branch preserving the complete source state before backend extraction, including shared files. It is not a Git stash entry.
- Use `but` for GitButler branch and commit mutations. Refresh IDs with `but status` before selecting changes; use explicit file selections for commits.
- To reopen the saved workspace, preserve pending work, unapply `chore/setup`, then apply `wip/database-auth`. Do not apply both snapshot branches together. See `README.md` for the commands.
- Keep future backend decisions already approved: Turso/libSQL with Drizzle, invitation-only Better Auth passkeys, single-use invitations expiring after 24 hours and roles assigned on the server.
- Do not add open sign-up, passwords or an email service. Future `pedagogy` access must be read-only, and passkeys require a stable HTTPS origin except for localhost in development.
- Restoring the snapshot does not merge later foundation changes automatically; backend reintegration requires an explicit request and validation.

## Working Practices

- Ask for decisions that change the product, scope or architecture; proceed with local implementation choices.
- Format changed files, then run lint, type checking and relevant tests.
- Before announcing that a task is complete, report the results and any checks that remain.
- Never read `.env`, `.env.*`, private keys or secret files; use `.env.example`.
- Use documentation matching the resolved versions, then the installed types and code if the documentation differs.
- Context7 is for library documentation: do not send it private code or sensitive data.
- Before a PR, identify its actual target branch; run `/review` against that base, then review the
  same diff for security: injections, access controls, secrets, sensitive data and dependencies.
- Codex rules cover common destructive commands; they do not replace checking the target.

## Scoping and Architecture

- Clarify a requirement with `$grill-me`. Use `$grill-with-docs` for technical scoping with documentation.
- These commands load `grilling`; `grill-with-docs` also loads `domain-modeling`.
- Prefer this project's copies in `.agents/skills` over personal skills with the same name.
- Future authentication work: `create-auth`, `better-auth-best-practices` and `better-auth-security-best-practices`. Reuse previously approved choices; skip their React examples in favor of the Svelte client.
- Components: `shadcn-svelte`, with the `#lib` aliases from `components.json`. No React shadcn skill.
- If a skill requests Claude's Skill tool, read the referenced local `SKILL.md` and its references in Codex.
- Glossary: `GLOSSARY.md`; decisions that are difficult to reverse: `docs/adr/`. Create them only as needed.
- The project does not use Linear. Scoping stays local.

## Design, Mobile and Accessibility

- Target: responsive web, desktop and mobile; accessibility goal: WCAG 2.2 AA.
- Follow existing components and, when present, `PRODUCT.md` and `DESIGN.md`.
- For a new UI or a redesign, use `$impeccable shape`, then critique, audit and polish.
- Define the product context with `$impeccable init`; do not invent requirements or the audience.
- Use `mobile-native` for touch interactions, the viewport, safe areas and the mobile keyboard.
- Use `accessibility` and `web-quality-audit` for WCAG audits; `performance` provides measurements.
- Prefer Impeccable's standard animations; respect `prefers-reduced-motion` and the project's tokens.
- Before finishing a UI, check its rendering with Playwright on desktop and mobile, keyboard
  interactions and accessible names/roles. An automated measurement alone does not prove WCAG compliance.
- Report any screen reader and real-device checks that could not be performed.

## Svelte AI Tools

- Read `svelte-code-writer` and `svelte-core-bestpractices` when analyzing or editing Svelte files.
- The official Svelte MCP is declared in `.codex/config.toml`; do not add a second Svelte server.
- Start with `list-sections`, then `get-documentation` for the relevant sections.
- If the MCP is unavailable in the session, use the official CLI already installed:
  `pnpm ai:svelte list-sections`, then `pnpm ai:svelte get-documentation 'kit/hooks,kit/auth'`.
- Before finishing a Svelte component, run `svelte-autofixer` through the MCP or
  `pnpm ai:svelte svelte-autofixer chemin/Composant.svelte`. Fix issues and rerun until none remain.
- The analysis CLI reads files locally. Do not send secrets or private data to a remote documentation tool.
- The Playwright server uses pnpm and a pinned version, with dependencies fetched on demand. Ignore `.playwright-mcp/` artifacts. Context7 remains reserved for external libraries when supplied by the agent host.
- Skills load on demand. No additional plugin, sub-agent or server by default.
- Files written in this project do not require a Playground link.
