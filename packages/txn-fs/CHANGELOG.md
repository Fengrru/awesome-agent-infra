# @fengru/txn-fs

## 0.1.1

### Patch Changes

- b67e860: Security hardening, lint cleanup, and coverage completion:

  - code-sandbox: block sandbox escapes via `node:` prefixed builtins, `Module._load` interception, and `process` access; add opt-in `allowDynamicImport` config; cover spawn-failure path
  - archiver: replace `Bun.gzipSync` monkey-patching with injectable `gzipFn` config backed by `node:zlib`; remove dead BunGlobal fallback code
  - dynamic-workflow: mitigate and document `node:vm` escape risks for dynamically generated workflows
  - fuzzy-patch: refactor unreachable head-tail-anchor branch into equivalent early-continue logic; cover all 8 strategies
  - worker, llm-dag-generator: restore 100% src line coverage with failure-path tests and explicit constructor attribution
  - repo-wide: fix all Biome errors/warnings (0/0), deduplicate UUID helpers onto `node:crypto`, correct README/CI coverage claims (100% gate, 42 packages), ignore `.comate/`
