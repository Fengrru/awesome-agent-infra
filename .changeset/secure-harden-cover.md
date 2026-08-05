---
"@fengru/archiver": minor
"@fengru/code-sandbox": minor
"@fengru/agentic-search": patch
"@fengru/agent-memory": patch
"@fengru/agent-metacog": patch
"@fengru/branch": patch
"@fengru/codegraph": patch
"@fengru/dynamic-workflow": patch
"@fengru/embedding": patch
"@fengru/event-bus": patch
"@fengru/fuzzy-patch": patch
"@fengru/hallucination-detector": patch
"@fengru/healix": patch
"@fengru/llm-dag-generator": patch
"@fengru/memory-engine-v2": patch
"@fengru/memory-graph": patch
"@fengru/pomdp-planner": patch
"@fengru/process-reward": patch
"@fengru/reasoning-search": patch
"@fengru/replay": patch
"@fengru/skillforge": patch
"@fengru/tracing": patch
"@fengru/txn-fs": patch
---

Security hardening, lint cleanup, and coverage completion:

- code-sandbox: block sandbox escapes via `node:` prefixed builtins, `Module._load` interception, and `process` access; add opt-in `allowDynamicImport` config; cover spawn-failure path
- archiver: replace `Bun.gzipSync` monkey-patching with injectable `gzipFn` config backed by `node:zlib`; remove dead BunGlobal fallback code
- dynamic-workflow: mitigate and document `node:vm` escape risks for dynamically generated workflows
- fuzzy-patch: refactor unreachable head-tail-anchor branch into equivalent early-continue logic; cover all 8 strategies
- worker, llm-dag-generator: restore 100% src line coverage with failure-path tests and explicit constructor attribution
- repo-wide: fix all Biome errors/warnings (0/0), deduplicate UUID helpers onto `node:crypto`, correct README/CI coverage claims (100% gate, 42 packages), ignore `.comate/`
