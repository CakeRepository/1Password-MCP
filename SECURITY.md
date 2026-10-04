# Security Policy

## Reporting a vulnerability

Security issues in this project are handled **in public**. Please open a [GitHub issue](https://github.com/CakeRepository/1Password-MCP/issues/new) with the full details so anyone can review the report and help fix it.

A useful report includes:

- **Affected version** — the `@takescake/1password-mcp` version you tested.
- **Impact** — what an attacker, a malicious prompt, or a crafted tool call can achieve.
- **Reproduction** — minimal steps, tool inputs, or a failing test.
- **Suggested fix** — optional. Pull requests are welcome.

**Never include real secrets.** Redact service account tokens, real `op://` references, and any revealed values before posting. If a token was exposed while testing, rotate it in 1Password.

## Supported versions

Fixes ship in the latest release only. Upgrade to the newest `4.x` to stay patched.

## After a fix

Confirmed vulnerabilities are fixed in a patch release, listed under **Security** in [CHANGELOG.md](CHANGELOG.md), and published as a GitHub Security Advisory crediting the reporter.
