# AGENTS.md

This file provides instructions for AI coding agents (Claude Code, Codex, Cursor, etc.) working on this repository.

## Project Overview

**awesome-agent-infra** is a TypeScript monorepo of 42 zero-dependency packages for building AI agent infrastructure. Scope: `@fengru/*` on npm. Runtime: Bun. Monorepo tool: Turborepo. Testing: Bun test. Linting: Biome.

## Commands

```bash
bun install              # Install all workspace dependencies
bun run typecheck        # Type-check all packages
biome check --write .    # Lint and auto-fix all files
bun run test             # Run all tests
bun run build            # Build all packages (tsc)
bun run integration      # Run integration tests
bun run docs             # Generate TypeDoc documentation
```

Never run `npm install` or `yarn` — use `bun` exclusively.

## Package Structure

```
packages/<name>/
  src/index.ts          # Entry point — only export public API here
  src/...               # Internal modules
  __tests__/            # Test files (bun:test)
  package.json          # Name: @fengru/<name>, type: module
  tsconfig.json         # Extends ../../tsconfig.base.json
```

## Code Conventions

- **Zero runtime dependencies** — never add npm runtime deps. Only use Node.js built-ins (`node:crypto`, `node:vm`, `node:fs`, etc.).
- **TypeScript strict mode** — no `any`, prefer `interface` over `type` for object shapes, use discriminated unions.
- **JSDoc** — every public export must have `@module`, `@param`, `@returns` tags.
- **No semicolons** — project uses Biome "asNeeded" semicolon style.
- **ESM only** — `"type": "module"`, use `.js` extension in relative imports.
- **Tests** — tests go in `__tests__/`, use `import { describe, expect, test } from "bun:test"`.
- **Factory functions** — prefer `createX()` over `new X()` for public constructors.
- **Private packages** — set `"private": true` in package.json for internal-only packages.

## Adding a New Package

1. Copy an existing package's structure
2. `package.json`: set `"name": "@fengru/<name>"`, update `"description"`
3. `tsconfig.json`: extend `../../tsconfig.base.json`
4. Add `typecheck`, `test`, `build` scripts (use `bun run build` for prepublishOnly)
5. Add the package to `typedoc.json` entry points
6. Run `bun install` from root

## PR Guidelines

- All PRs must pass `bun run typecheck` and `bun run test`
- Run `biome check --write .` before committing
- Add changeset if the PR changes any public API: `bun changeset`
- Keep PRs focused — one logical change per PR
