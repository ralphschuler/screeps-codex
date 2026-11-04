# Screeps Codex

A local stdio MCP server and portable plugin for **Screeps World on https://screeps.com only**. Read account/game data and, when explicitly enabled, replace code, change memory, activate a branch, or send a console expression. This is an unofficial integration, not a Screeps or OpenAI product.

No account has been connected by creating this package. No server deployment, token creation, or game changes are part of installation preparation.

## Requirements

- Node.js 22+ (24 recommended) on the machine that runs the MCP process. The bundled launcher supports macOS and Linux. Windows can use the direct Node configuration below.
- Node must be on PATH or installed at the standard macOS locations `/opt/homebrew/bin/node` or `/usr/local/bin/node`. ChatGPT’s embedded runtime is not a supported dependency.
- An MCP client supporting stdio.
- For authenticated game access, your own Screeps token supplied through `SCREEPS_TOKEN` in the server process environment.

`dist/server.mjs` is included in this repository. Running the bundled MCP server requires Node.js but no npm dependency installation. The bundle passed the automated stdio integration test; installation in an actual Codex client and live authenticated Screeps access have not yet been verified. Development uses the official MCP SDK and a locked dependency tree.

## Configuration and safety

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCREEPS_TOKEN` | Unset | Your Screeps token. Never place it in Git, chat, screenshots, or manifests. |
| `SCREEPS_SHARD` | `shard3` | Default shard for shard-specific operations. |
| `SCREEPS_WRITES` | Disabled | Only the exact value `true` enables write operations. |
| `SCREEPS_WRITE_BRANCHES` | Empty | Comma-separated code branch allowlist, such as `codex-staging`. Required for branch writes. |
| `SCREEPS_CONSOLE` | Disabled | Only `true` separately permits console execution, and writes must also be enabled. |

Start read-only. Use a staging branch first. Environment switches are server-side gates, not substitutes for the user's approval of a particular change. Review the actual tool schemas in your MCP client before calling writes.

Read operations cover connection/configuration status, the authenticated account, branches, branch code, memory, memory segments, and room terrain. Writes cover whole-branch code replacement, memory, segments, branch activation, and console expressions. There are no dedicated account-management, billing, trading, or arbitrary-URL tools. Console execution still carries arbitrary in-game authority, including trading and messages.

Code replacement uses a hash of the current remote modules. Read code first, preserve a local backup, review the full replacement, and supply the returned hash as the expected hash. A mismatch means reread and reconcile, not force-overwrite. The check reduces accidental stale writes; it cannot make the upstream read/write sequence atomic. Replacing a branch can remove modules omitted from the replacement. Editing a running branch or activating one can affect the live game immediately.

Memory and segments belong to the live shard, not to a staging code branch. Console expressions can mutate live game state and must be treated as code execution, even when an expression looks like a read. Keep console disabled unless needed. Do not blindly retry a write after a timeout: first inspect remote state to determine whether it succeeded.

## Minimum token endpoint access

[Screeps token documentation](https://docs.screeps.com/auth-tokens.html) allows endpoint and memory-segment restrictions. Its HTTP API is not a stable public API, so live compatibility must be checked. Choose only the capabilities you need, not full access. These paths come from this package's `src/server.js`:

| Capability | Endpoint access |
| --- | --- |
| Account and branches | `GET /api/auth/me`, `GET /api/user/branches` |
| Code reads | `GET /api/user/code` |
| Memory reads | `GET /api/user/memory` |
| Segment reads | `GET /api/user/memory-segment`, limited to needed segment IDs |
| Terrain | `GET /api/game/room-terrain` |
| Code replacement | `POST /api/user/code`, plus branch and code reads for safeguards |
| Branch activation | `POST /api/user/set-active-branch`, plus branch reads for verification |
| Memory changes | `POST /api/user/memory`, plus memory reads for backup/verification |
| Segment replacement | `POST /api/user/memory-segment`, plus segment reads and needed IDs |
| Console, only if intended | `POST /api/user/console` |

`screeps_status` needs no API scope. This server uses `X-Token`, never a token in the URL. Endpoint permissions are selected in Screeps account settings; this table is a request inventory, not an OAuth scope-string format. If the settings do not distinguish HTTP methods, a read-only endpoint grant alone may not prevent writes: retain the server's default write gate. No websocket permissions are needed. Do not broaden token access automatically after a permission error.

## Local plugin or Git marketplace

The repository root is the plugin root. `plugin.json` and `mcp.json` use the portable Agent Plugins format. The repository catalog is `.agents/plugins/marketplace.json`; its `./` source resolves from the repository root. The plugin-relative launcher `./scripts/launch.sh` resolves the installed bundle and finds a supported Node runtime. Persistent non-secret configuration uses the documented `PLUGIN_DATA` environment variable.

For a local checkout containing the published bundle, run from its directory:

```sh
codex plugin marketplace add .
codex plugin marketplace list
```

Then use the desktop app's Plugins Directory to install from **Screeps Codex** and restart when required. Supply environment variables through your trusted host's server environment configuration, outside this repository. Verify status without displaying the token. Portable `mcp.json` deliberately has no secret or speculative `${SCREEPS_TOKEN}` interpolation: credential forwarding is client-managed. If your client does not pass the required environment to bundled servers, use the direct MCP configuration below instead.

To add the Git marketplace source, use `codex plugin marketplace add https://github.com/ralphschuler/screeps-codex.git`. The package includes its server bundle; verify installation and credential forwarding in your intended client before using it. Git marketplace distribution is **not publication in the universal public Plugins Directory**. Public submission and review are separate; local MCP submissions currently require approved-partner eligibility.

## Private macOS token setup

Portable `mcp.json` has no `env_vars` forwarding field. Version 0.1.1 therefore offers an **opt-in macOS Keychain adapter**, rather than putting a token in a manifest or relying on environment inheritance.

1. Install Node.js from its official distribution if needed. The launcher checks PATH and the standard Homebrew/pkg locations; it does not download software or use ChatGPT internals.
2. Privately provision a **generic password** in Keychain Access with service/item name `screeps-codex` and account `default` (or your chosen account). Enter the Screeps token only in the native secure password field. Do not paste it into chat or use a shell command containing it.
3. Call `screeps_status` without credentials and use its `runtimeDataDirectory` value to locate the actual `PLUGIN_DATA` directory supplied by your plugin host. After approving persistent credential use, place the non-secret settings from `examples/runtime.macos.json` there as `runtime.json`. Never place the token in this file. The file must be owned by your user and not writable by other users.
4. Restart the plugin connection. The launcher reads only the designated Keychain service/account through `/usr/bin/security`, captures the result privately, and passes it to the server in memory. If macOS requests access, review the native prompt. Do not enable access for all applications or disable Keychain protections.
5. Check status, then verify account identity when authorized. Writes and console stay off until explicitly configured.

The adapter cannot create a token or Keychain item and does not search unrelated credentials. Without explicit `credentialSource: "macos-keychain"`, it never reads Keychain. It has a 15-second timeout; if the native prompt times out, prepare the user and restart instead of repeatedly prompting. Actual Keychain integration must be verified on macOS; automated tests use synthetic values.

If your host does not expose its `PLUGIN_DATA` location, use the direct Codex configuration below rather than guessing paths. For Linux/TrueNAS, keep using the host's trusted secret manager and Codex environment forwarding. There is no automatic plaintext token-file fallback.

## Direct Codex MCP configuration

As an alternative to the bundled server, add this to your personal `~/.codex/config.toml`, replacing the path with your actual checkout. Do not enable duplicate copies of the server.

```toml
[mcp_servers.screeps]
command = "/absolute/path/to/your/verified/node"
args = ["/absolute/path/to/screeps-codex/dist/server.mjs"]
env_vars = ["SCREEPS_TOKEN", "SCREEPS_SHARD", "SCREEPS_WRITES", "SCREEPS_WRITE_BRANCHES", "SCREEPS_CONSOLE"]
default_tools_approval_mode = "writes"
```

Use the actual installed Node executable path. Set those variables in the environment from which Codex starts, using a trusted secret mechanism. A GUI-launched client may not inherit your terminal environment. Do not put the token in command-line arguments or shared configuration. Restart the client after configuration changes, then check `/mcp` and call the status tool. A missing token should remain a clear setup error; never compensate by pasting it into tool arguments.

## Future TrueNAS VM setup

These are preparation instructions, not a deployment script:

1. Use a dedicated Linux VM on TrueNAS, rather than modifying the TrueNAS appliance OS. Give its non-root runtime user only the files it needs.
2. Install Node.js 24 from an official distribution and copy or clone this repository from its verified location. Check `node --version` and confirm `dist/server.mjs` is present.
3. Run the MCP client in that VM (or use a separately configured, trusted remote executor). Stdio connects a child process to its client; this package does not expose an HTTP service or listening port. Merely starting it as a background daemon will not connect a desktop client.
4. Provision `SCREEPS_TOKEN` privately to that process. Keep any secret file outside the checkout with permissions restricted to its owner. VM snapshots and backups may contain secrets; protect them too. Do not expose the token in service definitions committed to Git.
5. Permit outbound HTTPS to `screeps.com`. Do not expose an inbound MCP port or disable TLS verification. No private-server endpoint override is supported.
6. Start with writes and console disabled. Verify status, identity, branches, and a code read. Before allowing writes, confirm the account and shard, take a code backup, and configure a narrow branch allowlist.
7. Test any intended write on a staging branch only after approval. Live memory and console operations need separate care. Monitor the game after a code deployment and retain the previous modules for rollback.

Token creation, persistent credential configuration, and infrastructure deployment require their own deliberate setup. None is performed by this repository's build or test commands.

## Development

```sh
npm ci --ignore-scripts
npm run build
node --test
```

Commit the regenerated `dist/` bundle alongside source changes. CI builds and tests the source, makes the bundle available as a workflow artifact, and checks the committed bundle for drift. Tests must use mocked requests and synthetic credentials; never add a real token to CI to run this suite. A passing mocked test suite does not establish live account connectivity or a successful game deployment.

No project license has been chosen. Decide on a license before distributing this project as open source. Bundled dependencies retain their own notices and license obligations.

## References

- [OpenAI plugin packaging and marketplace documentation](https://developers.openai.com/plugins/build/plugins)
- [OpenAI local stdio packaging and public submission requirements](https://developers.openai.com/plugins/deploy/desktop-only)
- [Codex MCP environment forwarding and approval configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- [Portable MCP format and placeholders](https://agent-plugins.org/plugin-authors/mcp-servers)

Packaging references checked November 4, 2026. Client capabilities can change; installation and live Screeps behavior still need verification on the intended host.


- [Apple Keychain access controls](https://support.apple.com/en-gb/guide/mac-help/kychn002/26/mac/26)
