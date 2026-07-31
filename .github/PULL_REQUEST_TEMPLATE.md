## Summary

<!-- What does this PR do? One or two sentences. -->

## Changes

<!-- List the concrete changes, grouped by package or subsystem. -->

- `@fengru/foo`:
  - 
- `docs`:
  - 

## Test plan

<!-- How did you verify the change? -->

- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes
- [ ] `biome check --write .` produces no diff (or the diff was committed)
- [ ] Coverage gate passes for touched packages: `bun scripts/check-coverage.ts`

## API impact

<!-- If this changes a public API, describe it and add a changeset. -->

- [ ] No public API change
- [ ] Public API change — changeset added (`bun changeset`)
- [ ] Breaking change — migration notes included

## Checklist

- [ ] Code follows [AGENTS.md](AGENTS.md) conventions (zero runtime deps, ESM, strict TS, JSDoc)
- [ ] Tests added/updated in `__tests__/`
- [ ] README updated if user-facing behavior changed
- [ ] STABILITY.md classification updated if the package tier changed

Closes #
