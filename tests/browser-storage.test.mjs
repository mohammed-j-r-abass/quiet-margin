import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { zipSync,strToU8,unzipSync,strFromU8 } from 'fflate';
import { createLibraryDatabase } from '../src/browser/database.mjs';
import { createBackup,readBackup } from '../src/browser/backups.mjs';
import { cleanSettings,publicConnection,resolveConnection,rememberKeys,forgetKeys,safeEndpoint,providerRequest } from '../src/browser/connection.mjs';
import { chatLibrary } from '../src/browser/retrieval.mjs';

const id='11111111-1111-4111-8111-111111111111',noteId='22222222-2222-4222-8222-222222222222';
const timestamp='2026-01-01T00:00:00.000Z';
const doc={id,file:id+'.pdf',title:'Synthetic reading',author:'Example, Alex',year:'2026',pageCount:1,tags:[],scannedPages:[],createdAt:timestamp,updatedAt:timestamp};
const note={id:noteId,docId:id,quote:'The sample was small.',comment:'I questioned the evidence and sample size.',transcript:'',tags:[],rects:[],page:1,pageLabel:'101',color:'amber',highlight:false,anchor:{},createdAt:timestamp,updatedAt:timestamp};
const manifest={version:1,documents:[doc],annotations:[note],pages:[{doc_id:id,number:1,label:'101',text:'The sample was small.'}],workspace:{tabs:[id],activeId:id,positions:{},theme:'dark'}};
const files=[{name:doc.file,blob:new Blob(['%PDF- synthetic test'],{type:'application/pdf'})}];

test('different browser profiles never share a library',async()=>{
  const first=createLibraryDatabase(new IDBFactory(),'quiet-margin'),second=createLibraryDatabase(new IDBFactory(),'quiet-margin');
  await first.replace(structuredClone(manifest),files);
  assert.equal((await first.all('documents')).length,1);
  assert.deepEqual(await second.all('documents'),[]);
  await second.put('state',{key:'workspace',value:{tabs:[],theme:'light'}});
  assert.equal((await first.get('state','workspace')).value.theme,'dark');
  await first.close();await second.close();
});

test('saved documents, notes, and blobs survive closing and reopening storage',async()=>{
  const factory=new IDBFactory(),first=createLibraryDatabase(factory,'reopen');
  await first.replace(structuredClone(manifest),files);await first.close();
  const reopened=createLibraryDatabase(factory,'reopen');
  assert.equal((await reopened.get('documents',id)).title,doc.title);
  assert.equal((await reopened.get('annotations',noteId)).comment,note.comment);
  assert.equal(await (await reopened.get('files',doc.file)).blob.text(),'%PDF- synthetic test');
  await reopened.close();
});

test('failed restore rolls back all records and leaves the current library intact',async()=>{
  const db=createLibraryDatabase(new IDBFactory(),'rollback');
  await db.replace(structuredClone(manifest),files);
  const broken=structuredClone(manifest);delete broken.documents[0].id;
  await assert.rejects(db.replace(broken,[]));
  assert.equal((await db.get('documents',id)).title,doc.title);
  assert.equal((await db.get('files',doc.file)).blob.size,files[0].blob.size);
  await db.close();
});

test('successful restore retains a recoverable copy of the previous library',async()=>{
  const db=createLibraryDatabase(new IDBFactory(),'recovery');
  await db.replace(structuredClone(manifest),files);
  const next=structuredClone(manifest);next.documents[0].title='Replacement';
  await db.replace(next,files);
  const previous=(await db.get('state','recovery')).value;
  assert.equal(previous.documents[0].title,doc.title);
  const backup=await readBackup(await createBackup(previous));
  assert.equal(backup.manifest.documents[0].title,doc.title);
  await db.close();
});

test('backup roundtrip preserves passages and files and excludes provider configuration',async()=>{
  const snapshot={...structuredClone(manifest),files,state:[{key:'workspace',value:manifest.workspace},{key:'config',value:{apiKey:'never-export-this-key',endpoint:'https://provider.example/v1'}}]};
  const blob=await createBackup(snapshot),raw=unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.equal(strFromU8(raw['library.json']).includes('never-export-this-key'),false);
  assert.equal(strFromU8(raw['library.json']).includes('provider.example'),false);
  const restored=await readBackup(blob);
  assert.equal(restored.manifest.annotations[0].pageLabel,'101');
  assert.equal(restored.manifest.annotations[0].highlight,false);
  assert.equal(await restored.files[0].blob.text(),'%PDF- synthetic test');
});

test('restore rejects traversal paths, missing files, invalid records, and oversized declared entries',async()=>{
  const normal={'library.json':strToU8(JSON.stringify(manifest)),['files/'+doc.file]:strToU8('%PDF- sample')};
  await assert.rejects(readBackup(new Blob([zipSync({...normal,'../secrets.json':strToU8('bad')})])),/unexpected/);
  await assert.rejects(readBackup(new Blob([zipSync({'library.json':normal['library.json']})])),/mismatched|missing/);
  const broken=structuredClone(manifest);broken.annotations[0].docId='missing';
  await assert.rejects(readBackup(new Blob([zipSync({...normal,'library.json':strToU8(JSON.stringify(broken))})])),/invalid library records/);
  const bomb=zipSync(normal),view=new DataView(bomb.buffer,bomb.byteOffset,bomb.byteLength);
  for(let i=0;i<bomb.length-46;i++)if(view.getUint32(i,true)===0x02014b50){view.setUint32(i+24,400*1024*1024,true);break;}
  await assert.rejects(readBackup(new Blob([bomb])),/oversized/);
});

test('API keys are session-only and never exposed in saved settings or configuration responses',()=>{
  forgetKeys();
  const next=resolveConnection(null,{endpoint:'https://provider.example/v1',chatModel:'model',apiKey:'temporary-session-value'});
  rememberKeys(next);
  const saved=cleanSettings(next),publicValue=publicConnection(saved);
  assert.equal(saved.apiKey,undefined);assert.equal(publicValue.apiKey,undefined);assert.equal(publicValue.hasApiKey,true);
  assert.throws(()=>resolveConnection(saved,{endpoint:'https://another.example/v1'}),/existing key/);
  assert.throws(()=>resolveConnection(saved,{transcriptionEndpoint:'https://another.example/v1'}),/own key/);
  forgetKeys();assert.equal(publicConnection(saved).hasApiKey,false);
});

test('public provider connections reject insecure, local, and credential-bearing endpoints',()=>{
  for(const endpoint of ['http://provider.example/v1','https://user:password@provider.example/v1','https://127.0.0.1/v1','https://192.168.1.1/v1','https://[::1]/v1','https://computer.local/v1'])assert.throws(()=>safeEndpoint(endpoint));
  assert.equal(safeEndpoint('https://api.groq.com/openai/v1/chat/completions'),'https://api.groq.com/openai/v1');
});

test('provider requests omit cookies, referrers, and redirects and never echo raw errors',async()=>{
  const original=globalThis.fetch;
  try{
    globalThis.fetch=async(url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer temporary-value');return new Response(JSON.stringify({error:{message:'private-error-body'}}),{status:401});};
    await assert.rejects(providerRequest('https://provider.example/v1','temporary-value','/models',undefined,'GET'),error=>error.message.includes('401')&&!error.message.includes('private-error-body'));
  }finally{globalThis.fetch=original;}
});

test('keyword retrieval never sends a network request and AI requires explicit consent',async()=>{
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw new Error('Unexpected request');};
    const local=await chatLibrary(manifest,{query:'sample size'},{apiKey:'',chatModel:''});
    assert.equal(local.mode,'keyword');assert.equal(local.evidence[0].id,noteId);assert.equal(calls,0);
    await assert.rejects(chatLibrary(manifest,{query:'sample size'},{apiKey:'temporary-value',chatModel:'model'}),/Allow sending/);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('AI interpretations retain only evidence IDs found in the selected local library',async()=>{
  const original=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async()=>{
      calls++;
      const content=calls===1?{matches:[{id:noteId,score:.9},{id:'fabricated',score:1}]}:{statements:[{text:'You questioned the sample size.',source_ids:[noteId]},{text:'Invented evidence.',source_ids:['fabricated']}]};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200});
    };
    const answer=await chatLibrary(manifest,{query:'sample size',providerConsent:true},{endpoint:'https://provider.example/v1',apiKey:'temporary-value',chatModel:'model'});
    assert.equal(answer.statements.length,1);assert.equal(answer.statements[0].text,'You questioned the sample size.');assert.equal(calls,2);
  }finally{globalThis.fetch=original;}
});
