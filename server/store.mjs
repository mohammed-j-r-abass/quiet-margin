import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizeEndpoint,sameProvider} from './provider-config.mjs';

export const dataDir = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(path.join(dataDir, 'files'), { recursive: true });
export const db = new DatabaseSync(path.join(dataDir, 'library.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pages(doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, number INTEGER NOT NULL, label TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(doc_id,number));
CREATE TABLE IF NOT EXISTS annotations(id TEXT PRIMARY KEY, doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS embeddings(hash TEXT PRIMARY KEY, vector TEXT NOT NULL);`);
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const rows = table => db.prepare(`SELECT data FROM ${table}`).all().map(r => JSON.parse(r.data));
export const getDoc = id => { const r = db.prepare('SELECT data FROM documents WHERE id=?').get(id); return r ? JSON.parse(r.data) : null; };
export const getNote = id => { const r = db.prepare('SELECT data FROM annotations WHERE id=?').get(id); return r ? JSON.parse(r.data) : null; };
export const saveDoc = doc => db.prepare('INSERT INTO documents VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(doc.id, JSON.stringify(doc));
export const saveNote = note => db.prepare('INSERT OR REPLACE INTO annotations VALUES(?,?,?)').run(note.id, note.docId, JSON.stringify(note));
export const state = key => { const r = db.prepare('SELECT data FROM state WHERE key=?').get(key); return r ? JSON.parse(r.data) : null; };
export const setState = (key, value) => db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(key, JSON.stringify(value));
export const filePath = name => { if (!/^[a-f0-9-]{36}\.(pdf|webm|ogg|mp4|wav|mp3|m4a)$/.test(name)) throw new Error('Invalid stored file name'); return path.join(dataDir, 'files', name); };
const configPath = path.join(dataDir, 'secrets.json');
const defaults = () => ({ endpoint: process.env.AI_BASE_URL || 'https://api.openai.com/v1', apiKey: process.env.AI_API_KEY || '', chatModel: process.env.AI_CHAT_MODEL || 'gpt-4o-mini', embeddingModel: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small', transcriptionEndpoint: process.env.TRANSCRIPTION_BASE_URL || '', transcriptionKey: process.env.TRANSCRIPTION_API_KEY || '', transcriptionModel: process.env.TRANSCRIPTION_MODEL || '' });
export const config = () => ({ ...defaults(), ...(fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}) });
export const publicConfig = () => { const c = config(); return { ...c, apiKey: undefined, transcriptionKey: undefined, hasApiKey: !!c.apiKey, hasTranscriptionKey: !!(c.transcriptionKey || c.apiKey) }; };
export function updateConfig(input) {
  const previous=config(),c={...previous};
  if(input.endpoint&&c.apiKey&&!sameProvider(input.endpoint,c.endpoint)&&!input.apiKey?.trim())throw new Error('Enter a key for the new endpoint before saving. The existing key is kept with its current provider.');
  for (const k of Object.keys(c)) if (typeof input[k] === 'string' && input[k].length <= 2000) c[k] = input[k].trim();
  for (const key of ['endpoint', 'transcriptionEndpoint']) if (c[key]) c[key]=normalizeEndpoint(c[key]);
  const tmp = configPath + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(c, null, 2), { mode: 0o600 }); fs.renameSync(tmp, configPath);
  if(c.endpoint!==previous.endpoint||c.embeddingModel!==previous.embeddingModel)db.exec('DELETE FROM embeddings');
  return publicConfig();
}
