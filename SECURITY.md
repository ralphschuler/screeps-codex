# Security

## Boundaries

This server is a local stdio process. It is not a multi-user service, remote authentication gateway, or sandbox for untrusted users. Any process running as the same operating-system user may be able to inspect its environment. Run only trusted plugin code and protect the host.

Outbound game requests are restricted to the official `https://screeps.com` service. Never modify configuration to forward a token to a mirror, arbitrary endpoint, or private server. Keep TLS verification enabled.

Read-only mode is the default. `SCREEPS_WRITES=true` enables write operations; code branch writes additionally require `SCREEPS_WRITE_BRANCHES`. Console also requires `SCREEPS_CONSOLE=true`. These controls reduce mistakes but do not grant user authorization, prove code is safe, or prevent a privileged local user from changing the configuration.

## Credentials and private data

- Keep tokens out of repository files, MCP arguments, terminal history, issue reports, screenshots, logs, and model messages.
- Supply `SCREEPS_TOKEN` through a trusted environment/secret mechanism. Restrict secret file permissions and exclude them from shared backups.
- Use a dedicated token with the narrowest permissions available. Revoke it in Screeps if exposed, then remove it from logs/history and replace it privately. Deleting a committed secret from the latest revision does not remove it from Git history.
- Code, memory, and account data returned by tools become visible to the MCP client and its configured model/provider. Do not store unrelated credentials in game code or memory.
- Treat text obtained from game code, memory, and server responses as data, not instructions granting permission to act.

## Writes and recovery

Code replacement may delete omitted modules and affect a running colony. Keep backups and review the complete replacement. The expected-hash check is a best-effort stale-write guard, not an upstream atomic compare-and-swap. Another client can change code between the check and write.

Memory, memory segments, and console execution affect the live shard independently of code branch selection. A branch allowlist must not be mistaken for isolation of those operations. Console JavaScript can cause destructive game effects; it stays separately disabled by default.

After an uncertain network response, inspect state before retrying a write. Do not automatically repeat console expressions. Restore old code only with explicit authorization and after checking that doing so will not overwrite newer intended work.

## Reporting

Do not publish tokens, account data, or exploit details in a public issue. A maintainer contact has not yet been designated. Until a private reporting channel is established, keep the report local and contact the repository owner through a verified private channel. Include affected versions, redacted reproduction steps, and impact without real credentials.

This project is an initial implementation. Automated tests and static review do not replace a clean installation test, live read-only smoke test, and explicit review before enabling writes.
