export function normalizeEndpoint(value) {
  let u;
  try { u=new URL(String(value||'').trim()); } catch { throw new Error('Enter a valid HTTP(S) provider endpoint.'); }
  if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.search||u.hash)throw new Error('Use an HTTP(S) endpoint without embedded credentials, query parameters, or fragments.');
  u.pathname=u.pathname.replace(/\/+$/,'').replace(/\/(?:chat\/completions|embeddings|models|audio\/transcriptions)$/,'');
  if(u.hostname==='api.openai.com'&&(!u.pathname||u.pathname==='/'))u.pathname='/v1';
  return u.toString().replace(/\/+$/,'');
}
export const sameProvider=(a,b)=>new URL(normalizeEndpoint(a)).origin===new URL(normalizeEndpoint(b)).origin;
