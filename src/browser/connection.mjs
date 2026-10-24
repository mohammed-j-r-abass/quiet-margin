import { normalizeEndpoint, sameProvider } from '../../server/provider-config.mjs';

const defaults = { endpoint: 'https://api.groq.com/openai/v1', chatModel: '', embeddingModel: '', transcriptionEndpoint: '', transcriptionModel: '' };
let secrets = { apiKey: '', transcriptionKey: '' };
let keyVersion = 0;

export function safeEndpoint(value) {
  const endpoint = normalizeEndpoint(value), url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.hostname === 'localhost' || url.hostname.endsWith('.local') ||
      /^\[|^(?:0|10|127)\.|^169\.254\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname)) {
    throw new Error('The public website requires an HTTPS provider endpoint on a public host. Use the desktop version for local providers.');
  }
  return endpoint;
}

export const cleanSettings = value => Object.fromEntries(Object.keys(defaults).map(key => [key, typeof value?.[key] === 'string' ? value[key].trim().slice(0,2000) : defaults[key]]));
export const publicConnection = settings => ({ ...cleanSettings(settings), browserStorage: true, keyVersion, hasApiKey: !!secrets.apiKey, hasTranscriptionKey: !!(secrets.transcriptionKey || secrets.apiKey) });
export function forgetKeys() { secrets = { apiKey: '', transcriptionKey: '' }; keyVersion++; }

export function resolveConnection(settings, input = {}) {
  const saved = cleanSettings(settings), next = { ...saved, ...cleanSettings({ ...saved, ...input }) };
  next.endpoint = safeEndpoint(next.endpoint);
  if (next.transcriptionEndpoint) next.transcriptionEndpoint = safeEndpoint(next.transcriptionEndpoint);
  if (secrets.apiKey && !sameProvider(next.endpoint, saved.endpoint) && !input.apiKey?.trim()) {
    throw new Error('Enter a key for the new endpoint. The existing key will not be sent to another provider.');
  }
  if (input.transcriptionEndpoint !== undefined && secrets.transcriptionKey &&
      !sameProvider(next.transcriptionEndpoint || next.endpoint, saved.transcriptionEndpoint || saved.endpoint) && !input.transcriptionKey?.trim()) {
    throw new Error('Enter a transcription key for the new endpoint.');
  }
  const connection = { ...next, apiKey: typeof input.apiKey === 'string' ? input.apiKey.trim() : secrets.apiKey,
    transcriptionKey: typeof input.transcriptionKey === 'string' ? input.transcriptionKey.trim() : secrets.transcriptionKey };
  if (connection.transcriptionEndpoint && !sameProvider(connection.transcriptionEndpoint, connection.endpoint) && !connection.transcriptionKey) {
    throw new Error('A different transcription provider needs its own key. Your chat key will not be sent to another host.');
  }
  return connection;
}

export function rememberKeys(connection) {
  secrets = { apiKey: connection.apiKey, transcriptionKey: connection.transcriptionKey };
  keyVersion++;
}

// Credentials stay in memory and go only to the endpoint chosen by this visitor.
export async function providerRequest(base, key, route, body, method = 'POST') {
  let response;
  try {
    response = await fetch(safeEndpoint(base) + route, {
      method, credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
      headers: { ...(key ? { Authorization: 'Bearer ' + key } : {}), ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new Error('The provider could not be reached from your browser. Check its CORS/browser-access support, endpoint, and connection. Your library is still saved on this device. The desktop version can use providers that block browser requests.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 429) throw new Error('Provider limit reached (HTTP 429). Check your provider credits and request/token limits. Your library is safe.');
    if (response.status === 401) throw new Error('The provider rejected this key (HTTP 401). Check your key and endpoint.');
    if (response.status === 403 || response.status === 404) throw new Error('The model or API operation is unavailable. Check the model name, endpoint, and account access (HTTP ' + response.status + ').');
    throw new Error('The provider returned HTTP ' + response.status + '. Check the model and endpoint.');
  }
  if (!data || typeof data !== 'object') throw new Error('The provider returned invalid JSON.');
  return data;
}
