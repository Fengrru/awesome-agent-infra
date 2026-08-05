# Contributing

Contributions are welcome! See the repository [CONTRIBUTING.md](https://github.com/Fengrru/awesome-agent-infra/blob/main/CONTRIBUTING.md) for the full specification. Here are the essentials.

## Environment

- **Bun** 1.3+ (the only package manager — npm/yarn are forbidden)
- TypeScript 5.8+, Turborepo, Biome

```bash
bun install              # install dependencies
bun run typecheck        # type checking (55 tasks)
bun run test             # unit tests (85 tasks)
bun run lint             # strict lint (0 errors, 0 warnings)
```

## Code conventions (mandatory)

| Rule | Requirement |
|------|-------------|
| Zero runtime dependencies | Only `node:` built-in modules allowed; no npm runtime dependencies |
| TypeScript | strict mode, no `any`, prefer `interface` for object shapes, discriminated unions |
| JSDoc | Every public export must have `@module`/`@param`/`@returns` tags |
| Style | No semicolons (Biome asNeeded), double quotes, ESM (relative imports with `.js` extension) |
| Tests | `__tests__/` directory, `bun:test`, `import { describe, expect, test } from "bun:test"` |
| Factory functions | Public constructors use `createX()`, not `new X()` |
| Private packages | Marked with `"private": true` |

## Pre-commit checklist

```bash
bun run typecheck
bun run test
bun run lint        # biome check --error-on-warnings (must be 0 diagnostics)
bunx biome format --write .
```

## Adding a new package

1. Copy an existing package's structure
2. `package.json`: set `@fengrru/<name>`, update description, add `repository` + `publishConfig` fields
3. `tsconfig.json` extends `../../tsconfig.base.json`
4. Add the package to `typedoc.json` entryPoints
5. Run `bun install` from the root
6. If you changed public API, run `bun changeset` to add a changeset

## PR guidelines

- One logical change per PR
- Must pass typecheck + test + lint
- Public API changes require a changeset
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`...)
