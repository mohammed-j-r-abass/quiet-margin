import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { validateLibraryManifest } from '../../server/backup-validation.mjs';

const MB = 1024 * 1024;
const storedName = /^[a-f0-9-]{36}\.(pdf|webm|ogg|mp4|wav|mp3|m4a)$/;
const manifestFrom = snapshot => ({version:1,createdAt:new Date().toISOString(),documents:snapshot.documents,
  annotations:snapshot.annotations,pages:snapshot.pages,workspace:snapshot.state?.find(s=>s.key==='workspace')?.value || snapshot.workspace || {tabs:[],positions:{},theme:'dark'}});

export async function createBackup(snapshot) {
  const manifest = manifestFrom(snapshot), names = [...manifest.documents.map(d=>d.file),...manifest.annotations.map(n=>n.audioFile).filter(Boolean)];
  const entries = {'library.json':strToU8(JSON.stringify(manifest))};
  let total = entries['library.json'].length;
  for (const name of names) {
    const file = snapshot.files.find(f=>f.name===name);
    if (!storedName.test(name) || !file) throw new Error('A stored file is missing. The backup was not created.');
    total += file.blob.size;
    if (total > 256 * MB) throw new Error('This browser backup exceeds 256 MB. Export smaller libraries using the desktop app.');
    entries['files/'+name] = new Uint8Array(await file.blob.arrayBuffer());
  }
  const zip=zipSync(entries,{level:0});
  if(zip.length>256*MB)throw new Error('This browser backup exceeds the 256 MB archive limit.');
  return new Blob([zip],{type:'application/zip'});
}

export async function readBackup(blob) {
  if (!blob || blob.size > 256 * MB) throw new Error('Choose a backup ZIP up to 256 MB.');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let total = 0, count = 0;
  const seen = new Set();
  // Validate every entry before allocating its decompressed output.
  const inspect = file => {
    if (++count > 20000 || seen.has(file.name) ||
        (file.name !== 'library.json' && !/^files\/[a-f0-9-]{36}\.(pdf|webm|ogg|mp4|wav|mp3|m4a)$/.test(file.name)) ||
        ![0,8].includes(file.compression) || !Number.isSafeInteger(file.originalSize) || file.originalSize < 0 ||
        file.originalSize > (file.name==='library.json'?20:100)*MB ||
        (total += Math.max(file.originalSize,file.size)) > 256*MB) throw new Error('Backup has an unexpected, duplicate, or oversized entry.');
    seen.add(file.name);
    return false;
  };
  let entries;
  try {
    unzipSync(bytes,{filter:inspect});
    entries = unzipSync(bytes);
  } catch (error) { throw new Error('Invalid backup ZIP. ' + (error.message || '') + ' Your current library has not changed.'); }
  if (!entries['library.json']) throw new Error('The backup is missing its library manifest.');
  const manifest = JSON.parse(strFromU8(entries['library.json']));
  validateLibraryManifest(manifest);
  const names = [...manifest.documents.map(d=>d.file),...manifest.annotations.map(n=>n.audioFile).filter(Boolean)];
  if (new Set(names).size !== names.length || Object.keys(entries).length !== names.length+1) throw new Error('The backup contains mismatched files.');
  const files = [];
  for (const name of names) {
    if (!storedName.test(name) || !entries['files/'+name]) throw new Error('The backup is missing a valid stored file.');
    const bytes = entries['files/'+name], audio = manifest.annotations.find(n=>n.audioFile===name);
    if (name.endsWith('.pdf') && strFromU8(bytes.subarray(0,5))!=='%PDF-') throw new Error('The backup contains an invalid PDF.');
    if (audio && bytes.length > 25*MB) throw new Error('The backup contains an oversized recording.');
    files.push({name,blob:new Blob([bytes],{type:audio?.audioMime || 'application/pdf'})});
  }
  return {manifest,files};
}
