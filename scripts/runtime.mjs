import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const allowed = new Set(['credentialSource', 'keychainAccount', 'shard', 'writes', 'writeBranches', 'console']);
export async function readRuntimeConfiguration(directory, uid = process.getuid?.()) {
  const directoryInfo = await stat(directory);
  if (!directoryInfo.isDirectory() || (uid !== undefined && (directoryInfo.uid !== uid || (directoryInfo.mode & 0o022)))) {
    throw new Error('Unsafe runtime directory.');
  }
  const file = await open(join(directory, 'runtime.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 16384 || (uid !== undefined && (info.uid !== uid || (info.mode & 0o022)))) {
      throw new Error('Unsafe runtime configuration.');
    }
    return await file.readFile('utf8');
  } finally {
    await file.close();
  }
}
export async function runtimeEnvironment({
  env = process.env, platform = process.platform, uid = process.getuid?.(),
  readConfiguration = readRuntimeConfiguration, execute = run
} = {}) {
  let config = {};
  if (env.PLUGIN_DATA) {
    try {
      config = JSON.parse(await readConfiguration(env.PLUGIN_DATA, uid));
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error('Cannot read safe runtime.json configuration.');
    }
  }
  if (!config || Array.isArray(config) || typeof config !== 'object'
      || Object.keys(config).some(k => !allowed.has(k))) {
    throw new Error('runtime.json accepts only documented non-secret settings; never store a token there.');
  }
  const result = { ...env };
  if (config.shard !== undefined) {
    if (!/^shard[0-9]+$/.test(config.shard)) throw new Error('Invalid shard setting.');
    result.SCREEPS_SHARD = config.shard;
  }
  for (const [key, variable] of [['writes', 'SCREEPS_WRITES'], ['console', 'SCREEPS_CONSOLE']]) {
    if (config[key] !== undefined) {
      if (typeof config[key] !== 'boolean') throw new Error('Write and console settings must be booleans.');
      result[variable] = String(config[key]);
    }
  }
  if (config.writeBranches !== undefined) {
    if (!Array.isArray(config.writeBranches) || config.writeBranches.some(b => typeof b !== 'string' || !/^[a-zA-Z0-9_.-]{1,30}$/.test(b))) throw new Error('Invalid writeBranches setting.');
    result.SCREEPS_WRITE_BRANCHES = config.writeBranches.join(',');
  }
  if (config.credentialSource !== undefined && !['environment', 'macos-keychain'].includes(config.credentialSource)) throw new Error('Unsupported credential source.');
  if (config.credentialSource === 'macos-keychain') {
    if (platform !== 'darwin') throw new Error('macos-keychain requires macOS; use environment forwarding on this platform.');
    const account = config.keychainAccount ?? 'default';
    if (typeof account !== 'string' || !/^[a-zA-Z0-9_.@-]{1,128}$/.test(account)) throw new Error('Invalid Keychain account reference.');
    let output;
    try {
      output = await execute('/usr/bin/security', ['find-generic-password', '-s', 'screeps-codex', '-a', account, '-w'], {
        encoding: 'utf8', timeout: 15000, maxBuffer: 8192
      });
    } catch {
      throw new Error('Cannot access the designated Screeps Keychain item. Complete private setup and approve access if prompted.');
    }
    const token = output.stdout.trim();
    if (!token || /[\r\n]/.test(token)) throw new Error('The designated Keychain item contains an invalid token.');
    result.SCREEPS_TOKEN = token;
  } else if (config.keychainAccount !== undefined) {
    throw new Error('A Keychain account requires credentialSource macos-keychain.');
  }
  return result;
}
