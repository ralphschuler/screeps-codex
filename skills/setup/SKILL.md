---
name: setup
description: Set up the Screeps plugin runtime and a private credential source on the user's chosen host, without requesting or exposing secrets in chat.
---

# Set up Screeps

Confirm the intended host. Do not install or configure another computer merely because it is connected.

This plugin's bundled launcher supports macOS and Linux. Check for Node.js 22+ (24 recommended) on PATH, /opt/homebrew/bin/node, or /usr/local/bin/node. Do not use ChatGPT's internal embedded runtime as a persistent dependency. If no supported runtime exists, explain that prerequisite and obtain any required installation approval for the official Node distribution.

Portable mcp.json does not support arbitrary env_vars forwarding. Do not put credentials in mcp.json, config.toml, runtime.json, chat, tool arguments, terminal history, or logs. Do not print an environment or Keychain item to diagnose authentication.

On macOS, offer the explicit Keychain option. Before setting up persistent credential use, explain that the local plugin will read the specific generic-password item with service screeps-codex and account default (or a user-selected account) and send it only to https://screeps.com. Obtain the required approval. The user privately creates/provisions the item through Keychain Access. Never ask for the token in chat or run a command that prints it.

Call screeps_status and use its runtimeDataDirectory value to locate the host-provided PLUGIN_DATA directory; do not guess a cache path or place configuration in the installation cache. Only after permission, create its runtime.json with the non-secret settings from examples/runtime.macos.json. Keep it owned by the current user and not writable by other users. This reference is not a token. If PLUGIN_DATA cannot be determined, use the documented direct Codex configuration alternative instead of inventing a path.

Do not weaken Keychain access controls or allow all applications. Let the user approve any native Keychain prompt. If it times out, restart the server after the user is ready; do not automatically repeat credential prompts.

For Linux/TrueNAS or Windows, use the README's direct Codex env_vars configuration and the user's trusted secret manager. Windows requires direct Node launch; the bundled shell launcher is Unix-only. Obtain permission before configuring persistent secret access.

Keep writes and console disabled for setup. Verify screeps_status without displaying secrets, then screeps_me only when credential use is authorized. Report account identity and setup state. Never change game state during setup. Configure read/write behavior only as authorized, with a narrow branch allowlist and separate console decision.
