# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in awesome-agent-infra, please **do not** open a public issue.

Instead, report it via [GitHub Security Advisories](https://github.com/fengru/awesome-agent-infra/security/advisories/new) or email `security@fengrru.dev`.

You should receive a response within 48 hours. If the issue is confirmed, we will release a patch as soon as possible.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes |
| < latest | No |

We only support the latest released version of each package. Please upgrade before reporting issues.

## Security Design

- **Zero runtime dependencies** — the project has no npm runtime dependencies, minimizing supply chain attack surface. Only Node.js built-in modules are used (`node:crypto`, `node:vm`, `node:fs`, etc.).
- **No secrets in code** — the project never handles API keys, tokens, or credentials. These are the responsibility of downstream consumers.
- **`node:vm` sandbox** — the `dynamic-workflow` package uses `node:vm` for code isolation. Note that `vm` is NOT a true security sandbox (it shares the process). Consumers should use additional OS-level sandboxing for untrusted code execution.
- **`node:child_process`** — the `valid8` package spawns external tools (`semgrep`, `bandit`). These calls use timeouts and try/catch, but consumers should validate tool paths and inputs.

## Dependencies

Dependencies are audited via `bun install`'s built-in integrity checks. We do not use Dependabot or Renovate at this time because the project has zero runtime dependencies.
