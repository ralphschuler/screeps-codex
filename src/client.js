import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const MAX_RESPONSE = 8 * 1024 * 1024;
export function fingerprint(modules) {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(
    Object.entries(modules).sort(([a], [b]) => a.localeCompare(b))
  ))).digest('hex');
}
export function decodeMemory(data) {
  if (typeof data !== 'string') return data;
  if (data.startsWith('gz:')) {
    const decoded = gunzipSync(Buffer.from(data.slice(3), 'base64'), { maxOutputLength: MAX_RESPONSE }).toString('utf8');
    return JSON.parse(decoded);
  }
  try { return JSON.parse(data); } catch { return data; }
}
export class ScreepsClient {
  constructor({ token = '', fetchImpl = globalThis.fetch } = {}) {
    this.token = token;
    this.fetch = fetchImpl;
  }
  async request(path, { method = 'GET', query = {}, body } = {}) {
    if (!this.token) throw new Error('SCREEPS_TOKEN is not configured.');
    const url = new URL(path, 'https://screeps.com');
    if (url.origin !== 'https://screeps.com' || !url.pathname.startsWith('/api/')) throw new Error('Invalid API endpoint.');
    for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await this.fetch(url, {
        method, redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'X-Token': this.token, 'Accept': 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    } catch {
      throw new Error(method === 'GET' ? 'Screeps request failed or timed out.' : 'Write outcome unknown: inspect Screeps state before retrying.');
    }
    if (!response.ok) {
      if (response.status === 429) throw new Error('Screeps rate limit reached. Wait before retrying; writes are never automatically retried.');
      throw new Error('Screeps returned HTTP ' + response.status + '.' + (method === 'GET' ? '' : ' Write outcome may be unknown; inspect state before retrying.'));
    }
    let result;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > MAX_RESPONSE) throw new Error('response limit');
        chunks.push(chunk);
      }
      result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new Error(method === 'GET'
        ? 'Screeps response could not be read (invalid JSON, size limit, or interrupted stream).'
        : 'Write outcome unknown: response could not be read. Inspect Screeps state before retrying.');
    }
    if (result && typeof result === 'object' && (result.error || result.ok === 0)) {
      // Do not echo remote error bodies: they can contain credentials or prompt injection.
      throw new Error('Screeps API rejected the request.');
    }
    if (!result || Array.isArray(result) || result.ok !== 1) {
      throw new Error(method === 'GET' ? 'Unexpected Screeps response envelope.'
        : 'Write outcome unknown: unexpected response envelope. Inspect Screeps state before retrying.');
    }
    return result;
  }
}
