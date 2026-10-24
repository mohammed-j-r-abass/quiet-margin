export const browserStorage = import.meta.env.VITE_STORAGE === 'browser';
let csrf = '';
const local = () => import('./browser/api.mjs');

// Route the public build to this browser's disk storage.
export async function api(path, options = {}) {
  if (browserStorage) return (await local()).localApi(path, options);
  const form = options.body instanceof FormData;
  const response = await fetch('/api' + path, {
    ...options, headers:{...(options.body&&!form?{'Content-Type':'application/json'}:{}),'X-Library-Token':csrf,...options.headers},
    body:options.body&&!form?JSON.stringify(options.body):options.body,
  });
  const data = await response.json();
  if (path === '/bootstrap' && response.ok) csrf = data.token;
  if (response.status === 403 && data.error === 'Refresh the app before saving.' && !options.tokenRetried) {
    await api('/bootstrap');
    return api(path,{...options,tokenRetried:true});
  }
  if (!response.ok) throw Object.assign(new Error(data.error||'Request failed'),{code:data.code,action:data.action,providerStatus:data.providerStatus,retryAfter:data.retryAfter});
  return data;
}

export function persistWorkspace(workspace) {
  if (browserStorage) return api('/workspace',{method:'PUT',body:workspace});
  return fetch('/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json','X-Library-Token':csrf},body:JSON.stringify(workspace),keepalive:true});
}

export async function documentSource(id) {
  if (!browserStorage) return {url:'/api/documents/'+id+'/file'};
  const file = await api('/documents/'+id+'/file');
  return {data:new Uint8Array(await file.arrayBuffer())};
}

export async function audioSource(id) {
  if (!browserStorage) return '/api/annotations/'+id+'/audio';
  return URL.createObjectURL(await api('/annotations/'+id+'/audio'));
}

export async function downloadResource(path,{chooseFile=true}={}) {
  if (!browserStorage) { location.href = '/api' + path; return; }
  const name = path.includes('backup')?'quiet-margin-backup.zip':'quiet-margin-notes.md';
  let handle;
  try {
    if (chooseFile && window.showSaveFilePicker) handle = await window.showSaveFilePicker({suggestedName:name,types:[{description:path.includes('backup')?'Library backup':'Reading notes',accept:path.includes('backup')?{'application/zip':['.zip']}:{'text/markdown':['.md']}}]});
    const blob = await api(path);
    if (handle) {
      const writable = await handle.createWritable();
      try { await writable.write(blob); await writable.close(); }
      catch(error) { await writable.abort().catch(()=>{}); throw error; }
    } else {
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
    }
    return handle?'saved':'downloaded';
  } catch(error) { if(error.name!=='AbortError')throw error;return null; }
}
