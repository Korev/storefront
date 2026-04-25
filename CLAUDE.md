# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Where the real docs live

This repo is heavily documented for AI agents. Prefer reading these over re-discovering:

- **`AGENTS.md`** (root) — full architecture, gotchas, caching strategy, env vars. Read this first for any non-trivial task.
- **`skills/saleor-paper-storefront/rules/*.md`** — 11 task-specific rule files. Open the one matching your task:
  - `data-caching.md`, `data-graphql.md` — data layer (CRITICAL)
  - `product-pdp.md`, `product-variants.md`, `product-filtering.md` — product pages
  - `checkout-management.md`, `checkout-components.md` — checkout
  - `ui-components.md`, `ui-channels.md`, `seo-metadata.md`, `dev-investigation.md`
- **`.cursor/conventions.md`** — file-naming and import conventions (also apply to Claude).
- **`README.md`** — user-facing overview, env var reference.

## Commands

Package manager is **pnpm 10.28.1** (see `packageManager` in `package.json`); Node **20.x** required.

```bash
pnpm dev                    # Dev server (runs `generate:all` via predev hook)
pnpm build                  # Production build (runs `generate:all` via prebuild hook)
pnpm lint                   # ESLint (flat config in eslint.config.mjs)
pnpm lint:fix
pnpm exec tsc --noEmit      # Type check (there is no `typecheck` script)
pnpm test                   # Vitest in watch mode
pnpm test:run               # Vitest single run
pnpm test:run path/to/file.test.ts         # Run a single test file
pnpm test:run -t "test name substring"     # Run tests matching a name
pnpm knip                   # Find unused exports / deps

# GraphQL codegen — THIS REPO HAS TWO SEPARATE PIPELINES:
pnpm run generate           # Storefront: reads src/graphql/**/*.graphql → writes src/gql/
pnpm run generate:checkout  # Checkout:   reads src/checkout/graphql/**/*.graphql → writes src/checkout/graphql/generated/
pnpm run generate:all       # Both
```

After editing any `.graphql` file, run the matching `generate` command or types will be stale. `predev` / `prebuild` run `generate:all` automatically, so a normal `pnpm dev`/`build` covers it — but during iteration you need to run it manually for the TS types to update.

Vitest only picks up files matching `src/**/*.test.ts` (see `vitest.config.ts`), runs in the Node environment, and globals are enabled (`describe`/`it`/`expect` without imports).

## Big-picture architecture

### Two GraphQL codegen pipelines

The **storefront** and **checkout** modules each have their own codegen config and generated-types directory. They are not interchangeable.

| Area       | Queries live in         | Types generated to                | Config                            |
| ---------- | ----------------------- | --------------------------------- | --------------------------------- |
| Storefront | `src/graphql/`          | `src/gql/` (DO NOT EDIT)          | `.graphqlrc.ts`                   |
| Checkout   | `src/checkout/graphql/` | `src/checkout/graphql/generated/` | `src/checkout/graphql/codegen.ts` |

When adding a query, choose the pipeline that matches where it will be consumed; do not import checkout types from `src/gql/` or vice versa.

### Channel-scoped routing

Routes under `src/app/[channel]/` serve multi-currency / multi-region catalogs from one deployment (`/us/products/...`, `/eu/products/...`). Most pages read `params.channel` and pass it into Saleor queries. `src/app/checkout/` is the separate, non-channel-scoped checkout flow.

### Two GraphQL execution helpers

`src/lib/graphql.ts` exports:

- `executePublicGraphQL` — anonymous; public catalog data. Use for menus, products, categories.
- `executeAuthenticatedGraphQL` — forwards session cookies. Use for `me`, cart/checkout mutations, anything user-scoped.

Picking the wrong one is a common bug: public queries with auth break caching; authenticated queries without auth return `null` for user fields. See `AGENTS.md` §"GraphQL Auth Defaults" and `skills/saleor-paper-storefront/rules/data-graphql.md`.

### Display-cached, checkout-live data model

Product/category pages use Next.js Cache Components (PPR) with a 5-minute TTL and on-demand revalidation via `/api/revalidate` webhooks. Cart and checkout always fetch live (`cache: "no-cache"`). Saleor is the pricing source of truth — `checkoutLinesAdd` / `checkoutComplete` recalculate server-side. See `skills/saleor-paper-storefront/rules/data-caching.md` before touching caching behavior.

### State management

- Cart: React Context
- Checkout: Zustand (only in `src/checkout/`)
- Everything else: Server Components / URL state. Default to Server Components; add `"use client"` only for state, effects, event handlers, or browser APIs.

## Conventions that bite

- **Files**: kebab-case (`product-card.tsx`, `use-cart.ts`), including directories. **Exports**: PascalCase components / camelCase hooks — the mismatch with the filename is intentional (shadcn/ui convention). See `.cursor/conventions.md`.
- **Imports**: use the `@/` alias (`@/ui/components/ui/button`), not relative paths. Configured in `tsconfig.json` (`@/*` → `./src/*`).
- **Do not edit** `src/gql/` or `src/checkout/graphql/generated/` — both are regenerated on every `generate` / `predev` / `prebuild`.
- **Server-only modules** use the `.server.ts` suffix and import `"server-only"`.
- **Design tokens**, not hardcoded colors: use `bg-background`, `text-foreground`, etc. Tokens live in `src/styles/brand.css`.
- **Nullable Saleor fields**: Saleor's schema has many nullables. Use `?? fallback` for display values; throw/early-return when `null` indicates a real problem — don't silently render empty. Examples in `AGENTS.md` §"Common Gotchas".
- **Permission errors** like `MANAGE_...` on a query mean the field requires admin auth and must be fetched server-side with `SALEOR_APP_TOKEN`, not from the storefront.

## Environment

Minimum to run: copy `.env.example` → `.env`, set `NEXT_PUBLIC_SALEOR_API_URL` and `NEXT_PUBLIC_DEFAULT_CHANNEL`. Full env var list in `AGENTS.md` §"Environment Variables" (includes rate-limiting and webhook-secret vars).
