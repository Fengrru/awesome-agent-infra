# Contributing to awesome-agent-infra

Thanks for your interest in contributing!

## Getting Started

```bash
bun install        # Install all workspace dependencies
bun run typecheck  # Verify types compile
bun run test       # Run all tests
```

## Development Workflow

1. **Fork** the repository
2. **Create a branch** — `feat/xxx` or `fix/xxx`
3. **Make your changes** — follow the conventions in [AGENTS.md](AGENTS.md)
4. **Run lint** — `biome check --write .`
5. **Run tests** — `bun run test` (all packages) or `bun test --cwd packages/<name>` (single package)
6. **Add a changeset** — `bun changeset` (only if changing public API)
7. **Commit** — use conventional commit format: `feat: description`, `fix: description`, `chore: description`
8. **Open a PR** — against `main`

## Package Conventions

- **Zero runtime dependencies** — only Node.js built-ins. No npm runtime deps.
- **ESM only** — `"type": "module"`, `.js` extension in relative imports.
- **TypeScript strict** — no `any`, prefer `interface` for object shapes.
- **JSDoc** — every public export documented with `@module`, `@param`, `@returns`.
- **Tests** — `bun:test` in `__tests__/`, factory functions for test data.
- **One package = one responsibility** — if something doesn't fit, it's a new package.

## Adding a New Package

1. `mkdir packages/<name> && mkdir packages/<name>/src && mkdir packages/<name>/__tests__`
2. Create `package.json`, `tsconfig.json` (use existing packages as template)
3. Implement in `src/index.ts`
4. Write tests in `__tests__/<name>.test.ts`
5. Add to `typedoc.json` entry points
6. Run `bun install` from root

## Reporting Issues

Open an issue with:
- Package name and version
- Minimal reproduction steps
- Expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
