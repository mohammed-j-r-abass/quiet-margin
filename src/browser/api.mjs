import * as pdfjs from 'pdfjs-dist';
import { database } from './database.mjs';
import { cleanSettings, publicConnection, resolveConnection, rememberKeys, forgetKeys, providerRequest } from './connection.mjs';
import { chatLibrary } from './retrieval.mjs';
import { createBackup, readBackup } from './backups.mjs';
import { isHighlighted } from '../../shared/annotations.mjs';

const now = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const str = (value,max=5000) => typeof value==='string'?value.slice(0,max):'';
const tags = value => Array.isArray(value)?value.filter(t=>typeof t==='string').map(t=>t.trim().slice(0,80)).filter(Boolean).slice(0,30):[];
const setting = async key => (await database().get('state',key))?.value;
const stored = async (store,id) => {const row=await database().get(store,id);if(!row)throw new Error('This item was not found in this browser.');return row;};
const audioTypes = {'audio/webm':'webm','video/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3','audio/x-wav':'wav'};

async function importPDF(file) {
  if (!file || file.size>100*1024*1024 || new TextDecoder().decode(await file.slice(0,5).arrayBuffer())!=='%PDF-') throw new Error('Choose a valid PDF up to 100 MB.');
  const task = pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,
    cMapUrl:import.meta.env.BASE_URL+'pdf-assets/cmaps/',cMapPacked:true,standardFontDataUrl:import.meta.env.BASE_URL+'pdf-assets/standard_fonts/',wasmUrl:import.meta.env.BASE_URL+'pdf-assets/wasm/'});
  try {
    const pdf = await task.promise;
    if (pdf.numPages>3000) throw new Error('This PDF exceeds the 3,000-page limit.');
    const id=uid(),createdAt=now(),labels=await pdf.getPageLabels().catch(()=>null),meta=await pdf.getMetadata().catch(()=>({info:{}}));
    const doc={id,file:id+'.pdf',title:str(meta.info.Title?.trim()||file.name?.replace(/\.pdf$/i,'')||'Untitled PDF'),author:str(meta.info.Author),
      publication:'',year:'',doi:'',url:'',publisher:'',volume:'',issue:'',pages:'',citationType:'article-journal',tags:[],collection:'Inbox',reviewed:false,
      pageCount:pdf.numPages,hasPageLabels:!!labels,createdAt,updatedAt:createdAt,originalName:str(file.name),scannedPages:[]};
    const pages=[];
    for(let number=1;number<=pdf.numPages;number++){
      const page=await pdf.getPage(number),content=await page.getTextContent(),text=content.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('');
      if(!text.trim())doc.scannedPages.push(number);
      pages.push({doc_id:id,number,label:labels?.[number-1]||'',text});page.cleanup();
    }
    await database().transaction(['documents','pages','files'],'readwrite',tx=>{
      tx.objectStore('documents').put(doc);
      for(const page of pages)tx.objectStore('pages').put(page);
      tx.objectStore('files').put({name:doc.file,blob:file.slice(0,file.size,'application/pdf')});
    });
    return doc;
  } catch(error){throw new Error('Could not import this PDF. '+error.message);} finally {await task.destroy();}
}

async function editableNote(input,doc,base={}) {
  const page=input.page===null||input.page===undefined?null:Number(input.page);
  if(page!==null&&(!Number.isInteger(page)||page<1||page>doc.pageCount))throw new Error('Invalid PDF page.');
  const rects=Array.isArray(input.rects)?input.rects.slice(0,500).map(r=>({x:Number(r.x),y:Number(r.y),w:Number(r.w),h:Number(r.h)})).filter(r=>Object.values(r).every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.x<=1&&r.y<=1&&r.w>0&&r.h>0&&r.w<=1&&r.h<=1):[];
  const transcript=str(input.transcript,100000),transcriptHistory=[...(base.transcriptHistory||[])];
  if(base.transcript&&base.transcript!==transcript)transcriptHistory.push({text:base.transcript,savedAt:now(),reason:'Previous transcript before a manual edit'});
  return {...base,quote:str(input.quote,100000),comment:str(input.comment,100000),transcript,transcriptHistory,page,
    pageLabel:page?(await database().get('pages',[doc.id,page]))?.label||null:null,
    highlight:typeof input.highlight==='boolean'?input.highlight:('quote'in base?isHighlighted(base):false),rects,
    anchor:{prefix:str(input.anchor?.prefix,500),suffix:str(input.anchor?.suffix,500),start:Number(input.anchor?.start)||0,end:Number(input.anchor?.end)||0},
    tags:tags(input.tags),color:['amber','sage','rose','blue'].includes(input.color)?input.color:'amber',updatedAt:now()};
}

export async function localApi(path,{method='GET',body}={}) {
  try { return await route(path,method,body); }
  catch(error){if(error.name==='QuotaExceededError')throw new Error('This browser has run out of storage. Save a backup, free disk space, and retry. The last transaction was not saved.');throw error;}
}

async function route(path,method,body={}) {
  const db=database(),url=new URL(path,'https://quiet-margin.invalid'),parts=url.pathname.split('/').filter(Boolean),[resource,id,action]=parts;
  if(resource==='bootstrap'){
    const snapshot=await db.snapshot();
    return {token:'',documents:snapshot.documents,annotations:snapshot.annotations,workspace:snapshot.state.find(s=>s.key==='workspace')?.value||{tabs:[],positions:{},theme:'dark'},config:publicConnection(await setting('config'))};
  }
  if(resource==='workspace'&&method==='PUT'){await db.put('state',{key:'workspace',value:body});return {savedAt:now()};}
  if(resource==='config'&&method==='PUT'){
    if(body.forgetKeys){forgetKeys();return publicConnection(await setting('config'));}
    const next=resolveConnection(await setting('config'),body);
    await db.put('state',{key:'config',value:cleanSettings(next)});rememberKeys(next);return publicConnection(next);
  }
  if(resource==='provider'){
    const c=resolveConnection(await setting('config'),body);
    if(!c.apiKey)throw new Error('Enter your provider key for this tab session.');
    if(id==='models'){
      const r=await providerRequest(c.endpoint,c.apiKey,'/models',undefined,'GET');
      if(!Array.isArray(r.data))throw new Error('This provider does not return a standard model list. Enter the model name manually.');
      return {models:[...new Set(r.data.map(m=>m?.id).filter(v=>typeof v==='string'&&v.length<=250))].sort()};
    }
    if(!c.chatModel)throw new Error('Enter a model name to test.');
    const r=await providerRequest(c.endpoint,c.apiKey,'/chat/completions',{model:c.chatModel,messages:[{role:'user',content:'Connection test only. Reply OK.'}]});
    if(typeof r.choices?.[0]?.message?.content!=='string')throw new Error('The provider returned no chat text.');
    return {ok:true,message:'The model responded. No documents or notes were sent.'};
  }
  if(resource==='documents'){
    if(!id&&method==='POST')return importPDF(body.get('pdf'));
    const doc=await stored('documents',id);
    if(action==='file')return (await stored('files',doc.file)).blob;
    if(action==='pages')return (await db.all('pages')).filter(p=>p.doc_id===id).sort((a,b)=>a.number-b.number);
    if(action==='citation'){
      const page=Number(url.searchParams.get('page'))||null;
      if(page!==null&&(!Number.isInteger(page)||page<1||page>doc.pageCount))throw new Error('Invalid PDF page.');
      const label=page?(await db.get('pages',[id,page]))?.label||null:null;
      return {...(await import('./citations.mjs')).citation(doc,label),pdfPage:page,pageLabel:label};
    }
    if(method==='PATCH'){
      for(const key of ['title','author','publication','year','doi','url','publisher','volume','issue','pages','accessed','citationType','collection'])if(key in body)doc[key]=str(body[key]);
      if('tags'in body)doc.tags=tags(body.tags);if('reviewed'in body)doc.reviewed=!!body.reviewed;
      doc.updatedAt=now();await db.put('documents',doc);return doc;
    }
    if(method==='DELETE'){
      const notes=(await db.all('annotations')).filter(n=>n.docId===id);
      await db.transaction(['documents','annotations','pages','files'],'readwrite',tx=>{
        tx.objectStore('documents').delete(id);tx.objectStore('files').delete(doc.file);
        for(let n=1;n<=doc.pageCount;n++)tx.objectStore('pages').delete([id,n]);
        for(const note of notes){tx.objectStore('annotations').delete(note.id);if(note.audioFile)tx.objectStore('files').delete(note.audioFile);}
      });return {ok:true};
    }
  }
  if(resource==='annotations'){
    if(!id&&method==='POST'){
      const doc=await stored('documents',body.docId),note=await editableNote(body,doc,{id:uid(),docId:doc.id,createdAt:now(),originalTranscript:''});
      await db.put('annotations',note);return note;
    }
    const note=await stored('annotations',id);
    if(action==='audio'){
      if(method==='GET'){if(!note.audioFile)throw new Error('No recording.');return (await stored('files',note.audioFile)).blob;}
      const old=note.audioFile;
      let file;
      if(method==='POST'){
        const blob=body.get('audio'),mime=blob?.type.split(';')[0];
        if(!blob||!audioTypes[mime]||blob.size>25*1024*1024)throw new Error('Use a supported recording up to 25 MB.');
        note.audioFile=uid()+'.'+audioTypes[mime];note.audioMime=mime;file={name:note.audioFile,blob:blob.slice(0,blob.size,mime)};
      }else{delete note.audioFile;delete note.audioMime;}
      note.updatedAt=now();
      await db.transaction(['annotations','files'],'readwrite',tx=>{tx.objectStore('annotations').put(note);if(old)tx.objectStore('files').delete(old);if(file)tx.objectStore('files').put(file);});return note;
    }
    if(action==='transcribe'){
      const c=resolveConnection(await setting('config'));
      if(!c.transcriptionModel||!(c.transcriptionKey||c.apiKey)||!note.audioFile)throw new Error('Configure a transcription model/key and save a recording first.');
      const endpoint=c.transcriptionEndpoint||c.endpoint;
      if(!confirm('Send this recording to '+new URL(endpoint).host+' for transcription? Your saved original stays on this device.'))throw new Error('Transcription canceled. The recording is saved locally.');
      const form=new FormData();form.append('model',c.transcriptionModel);form.append('file',(await stored('files',note.audioFile)).blob,note.audioFile);form.append('response_format','json');
      const r=await providerRequest(endpoint,c.transcriptionKey||c.apiKey,'/audio/transcriptions',form);
      if(typeof r.text!=='string')throw new Error('The provider returned no transcript.');
      if(note.transcript&&note.transcript!==r.text)note.transcriptHistory=[...(note.transcriptHistory||[]),{text:note.transcript,savedAt:now(),reason:'Previous transcript before provider transcription'}];
      if(!note.originalTranscript)note.originalTranscript=r.text;note.transcript=r.text;note.transcribedAt=now();note.updatedAt=now();await db.put('annotations',note);return note;
    }
    if(method==='PATCH'){const updated=await editableNote({...note,...body},await stored('documents',note.docId),note);await db.put('annotations',updated);return updated;}
    if(method==='DELETE'){await db.transaction(['annotations','files'],'readwrite',tx=>{tx.objectStore('annotations').delete(id);if(note.audioFile)tx.objectStore('files').delete(note.audioFile);});return {ok:true};}
  }
  if(resource==='chat')return chatLibrary(await db.snapshot(),body,resolveConnection(await setting('config')));
  if(resource==='backup')return createBackup(await db.snapshot(true));
  if(resource==='recovery-backup'){
    const recovery=await setting('recovery');if(!recovery)throw new Error('No previous-library recovery copy is available.');return createBackup(recovery);
  }
  if(resource==='restore'&&method==='POST'){const {manifest,files}=await readBackup(body.get('backup'));await db.replace(manifest,files);return {ok:true};}
  if(resource==='export')return exportNotes(url.searchParams.get('docId'));
  throw new Error('This operation is unavailable in this browser version.');
}

async function exportNotes(docId) {
  const snapshot=await database().snapshot(),{citation}=await import('./citations.mjs');
  let text='# Quiet Margin — reading notes\n\nExported '+now()+'\n\n';
  for(const doc of snapshot.documents.filter(d=>!docId||d.id===docId)){
    const c=citation(doc);text+='## '+doc.title+'\n\n'+c.worksCited+'\n\nMetadata: '+(doc.reviewed?'reviewed':'not reviewed')+'. Missing: '+c.missing.join(', ')+'\n\n';
    for(const note of snapshot.annotations.filter(n=>n.docId===doc.id)){
      text+='### '+(note.page?'PDF page '+note.page+(note.pageLabel?' · printed label '+note.pageLabel:' · printed label unavailable'):'Document thought')+'\n\nAnnotation ID: '+note.id+'\nCreated: '+note.createdAt+' · Updated: '+note.updatedAt+'\n\n';
      if(note.quote)text+='**Author quotation**\n\n> '+note.quote.replace(/\n/g,'\n> ')+'\n\n';
      text+='**My thought**\n\n'+(note.comment||'(No written comment)')+'\n\n';
      if(note.transcript)text+='**My audio transcript**\n\n'+note.transcript+'\n\n';
      if(note.originalTranscript)text+='**Original provider transcript**\n\n'+note.originalTranscript+'\n\n';
      for(const version of note.transcriptHistory||[])text+='**Previous transcript** '+version.savedAt+' — '+version.reason+'\n\n'+version.text+'\n\n';
      if(note.audioFile)text+='Recording: files/'+note.audioFile+' (included in a library backup)\n\n';
      if(note.tags.length)text+='Tags: '+note.tags.join(', ')+'\n\n';
      text+='Suggested citation: '+citation(doc,note.pageLabel).inText+'\n\n';
    }
  }
  return new Blob([text],{type:'text/markdown'});
}
