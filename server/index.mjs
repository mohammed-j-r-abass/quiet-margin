import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { db, dataDir, uid, now, rows, getDoc, getNote, saveDoc, saveNote, state, setState, filePath, config, publicConfig, updateConfig } from './store.mjs';
import { retrieve, chat, transcribe } from './retrieval.mjs';
import { validateLibraryManifest } from './backup-validation.mjs';
import {listModels,testConnection} from './provider.mjs';
import {isHighlighted} from '../shared/annotations.mjs';

const root=path.resolve('.'), app=express(), port=Number(process.env.PORT||4317), token=crypto.randomBytes(32).toString('hex');
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:100*1024*1024,files:1,fieldSize:2*1024*1024}});
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
app.disable('x-powered-by');
app.use((req,res,next)=>{
  if(!['localhost','127.0.0.1','[::1]'].includes(req.hostname)) return res.status(403).json({error:'Local access only'});
  res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'no-store'});
  if(req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)) return res.status(403).json({error:'Origin not allowed'});
  if(req.path.startsWith('/api') && !['GET','HEAD'].includes(req.method) && req.headers['x-library-token']!==token) return res.status(403).json({error:'Refresh the app before saving.'});
  next();
});
app.use(express.json({limit:'2mb'}));
const requireDoc=id=>{const d=getDoc(id);if(!d)throw Object.assign(new Error('Document not found'),{status:404});return d;};
const requireNote=id=>{const n=getNote(id);if(!n)throw Object.assign(new Error('Annotation not found'),{status:404});return n;};
const str=(s,max=5000)=>typeof s==='string'?s.slice(0,max):'';
const tags=t=>Array.isArray(t)?t.filter(x=>typeof x==='string').map(t=>t.trim().slice(0,80)).filter(Boolean).slice(0,30):[];
const docFields=['title','author','publication','year','doi','url','publisher','volume','issue','pages','accessed','citationType','collection'];
app.get('/api/bootstrap',(req,res)=>res.json({token,documents:rows('documents'),annotations:rows('annotations'),workspace:state('workspace')||{tabs:[],activeId:null,positions:{},theme:'dark'},config:publicConfig()}));
app.put('/api/workspace',(req,res)=>{const w=req.body;if(!Array.isArray(w.tabs)||typeof w.positions!=='object')return res.status(400).json({error:'Invalid workspace'});setState('workspace',w);res.json({savedAt:now()});});
app.post('/api/documents',upload.single('pdf'),wrap(async(req,res)=>{
  if(!req.file || req.file.buffer.subarray(0,5).toString()!=='%PDF-')return res.status(400).json({error:'Choose a valid PDF file (up to 100 MB).'});
  let pdf,loadingTask;try{loadingTask=getDocument({data:new Uint8Array(req.file.buffer),useSystemFonts:true,isEvalSupported:false});pdf=await loadingTask.promise;}catch{await loadingTask?.destroy();return res.status(400).json({error:'This PDF cannot be opened. It may be encrypted or damaged. Save an unlocked copy and try again.'});}
  if(pdf.numPages>3000){await loadingTask.destroy();return res.status(400).json({error:'This PDF exceeds the 3,000-page limit.'});}
  const id=uid(), createdAt=now(), labels=await pdf.getPageLabels().catch(()=>null), meta=await pdf.getMetadata().catch(()=>({info:{}}));
  const doc={id,file:id+'.pdf',title:meta.info.Title?.trim()||req.file.originalname.replace(/\.pdf$/i,''),author:meta.info.Author||'',publication:'',year:'',doi:'',url:'',publisher:'',volume:'',issue:'',pages:'',citationType:'article-journal',tags:[],collection:'Inbox',reviewed:false,pageCount:pdf.numPages,hasPageLabels:!!labels,createdAt,updatedAt:createdAt,originalName:req.file.originalname,scannedPages:[]};
  const pages=[];
  try{for(let n=1;n<=pdf.numPages;n++){const p=await pdf.getPage(n);const tc=await p.getTextContent();const text=tc.items.map(i=>i.str+(i.hasEOL?'\n':' ')).join('');pages.push({number:n,label:labels?.[n-1]||'',text});if(!text.trim())doc.scannedPages.push(n);p.cleanup();}}finally{await loadingTask.destroy();}
  fs.writeFileSync(filePath(doc.file),req.file.buffer);
  db.exec('BEGIN');try{saveDoc(doc);for(const p of pages)db.prepare('INSERT INTO pages VALUES(?,?,?,?)').run(id,p.number,p.label,p.text);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');fs.unlinkSync(filePath(doc.file));throw e;}
  res.status(201).json(doc);
}));
app.get('/api/documents/:id/file',(req,res)=>{const d=requireDoc(req.params.id);res.type('pdf').sendFile(filePath(d.file));});
app.get('/api/documents/:id/pages',(req,res)=>{requireDoc(req.params.id);res.json(db.prepare('SELECT number,label,text FROM pages WHERE doc_id=? ORDER BY number').all(req.params.id));});
app.patch('/api/documents/:id',(req,res)=>{const d=requireDoc(req.params.id);for(const k of docFields)if(k in req.body)d[k]=str(req.body[k]);if('tags'in req.body)d.tags=tags(req.body.tags);if('reviewed'in req.body)d.reviewed=!!req.body.reviewed;d.updatedAt=now();saveDoc(d);res.json(d);});
app.delete('/api/documents/:id',(req,res)=>{const d=requireDoc(req.params.id),notes=rows('annotations').filter(n=>n.docId===d.id);db.prepare('DELETE FROM documents WHERE id=?').run(d.id);for(const f of [d.file,...notes.map(n=>n.audioFile).filter(Boolean)])if(fs.existsSync(filePath(f)))fs.unlinkSync(filePath(f));res.json({ok:true});});
function editableNote(input,doc,base={}){
  const page=input.page===null||input.page===undefined?null:Number(input.page);
  if(page!==null&&(!Number.isInteger(page)||page<1||page>doc.pageCount))throw new Error('Invalid PDF page');
  const rects=Array.isArray(input.rects)?input.rects.slice(0,500).map(r=>({x:Number(r.x),y:Number(r.y),w:Number(r.w),h:Number(r.h)})).filter(r=>Object.values(r).every(Number.isFinite)&&r.x>=0&&r.y>=0&&r.x<=1&&r.y<=1&&r.w>0&&r.h>0&&r.w<=1&&r.h<=1):[];
  const transcript=str(input.transcript,100000),transcriptHistory=[...(base.transcriptHistory||[])];
  if(base.transcript&&base.transcript!==transcript)transcriptHistory.push({text:base.transcript,savedAt:now(),reason:'Previous transcript before a manual edit'});
  return {...base,highlight:typeof input.highlight==='boolean'?input.highlight:('quote' in base?isHighlighted(base):input.highlightOnly===true),quote:str(input.quote,100000),comment:str(input.comment,100000),transcript,transcriptHistory,page,pageLabel:page?db.prepare('SELECT label FROM pages WHERE doc_id=? AND number=?').get(doc.id,page).label:null,rects,anchor:{prefix:str(input.anchor?.prefix,500),suffix:str(input.anchor?.suffix,500),start:Number(input.anchor?.start)||0,end:Number(input.anchor?.end)||0},tags:tags(input.tags),color:['amber','sage','rose','blue'].includes(input.color)?input.color:'amber',updatedAt:now()};
}
app.post('/api/annotations',(req,res)=>{const doc=requireDoc(req.body.docId);const note=editableNote(req.body,doc,{id:uid(),docId:doc.id,createdAt:now(),originalTranscript:''});saveNote(note);res.status(201).json(note);});
app.patch('/api/annotations/:id',(req,res)=>{const n=requireNote(req.params.id);const updated=editableNote({...n,...req.body},requireDoc(n.docId),n);saveNote(updated);res.json(updated);});
app.delete('/api/annotations/:id',(req,res)=>{const n=requireNote(req.params.id);db.prepare('DELETE FROM annotations WHERE id=?').run(n.id);if(n.audioFile&&fs.existsSync(filePath(n.audioFile)))fs.unlinkSync(filePath(n.audioFile));res.json({ok:true});});
app.post('/api/annotations/:id/audio',upload.single('audio'),(req,res)=>{
  const n=requireNote(req.params.id),file=req.file;
  const types={'audio/webm':'webm','video/webm':'webm','audio/ogg':'ogg','audio/mp4':'mp4','audio/wav':'wav','audio/mpeg':'mp3','audio/x-wav':'wav'};
  const mime=file?.mimetype?.split(';')[0];if(!file||!types[mime]||file.size>25*1024*1024)return res.status(400).json({error:'Use a supported audio recording up to 25 MB.'});
  const old=n.audioFile;n.audioFile=uid()+'.'+types[mime];n.audioMime=mime;n.updatedAt=now();fs.writeFileSync(filePath(n.audioFile),file.buffer);saveNote(n);if(old&&fs.existsSync(filePath(old)))fs.unlinkSync(filePath(old));res.json(n);
});
app.get('/api/annotations/:id/audio',(req,res)=>{const n=requireNote(req.params.id);if(!n.audioFile)return res.status(404).json({error:'No recording'});res.type(n.audioMime).sendFile(filePath(n.audioFile));});
app.delete('/api/annotations/:id/audio',(req,res)=>{const n=requireNote(req.params.id);if(n.audioFile&&fs.existsSync(filePath(n.audioFile)))fs.unlinkSync(filePath(n.audioFile));delete n.audioFile;delete n.audioMime;n.updatedAt=now();saveNote(n);res.json(n);});
app.post('/api/annotations/:id/transcribe',wrap(async(req,res)=>res.json(await transcribe(requireNote(req.params.id)))));
app.get('/api/search',wrap(async(req,res)=>{const q=str(req.query.q,1000);res.json(await retrieve(q,req.query.docId?[req.query.docId]:[],false,false));}));
app.post('/api/chat',wrap(async(req,res)=>{const q=str(req.body.query,2000).trim();if(!q)return res.status(400).json({error:'Enter a question'});res.json(await chat(q,Array.isArray(req.body.docIds)?req.body.docIds:[],req.body.includeFullText===true));}));
app.put('/api/config',(req,res)=>res.json(updateConfig(req.body)));
app.post('/api/provider/models',wrap(async(req,res)=>res.json(await listModels(req.body))));
app.post('/api/provider/test',wrap(async(req,res)=>res.json(await testConnection(req.body))));

plugins.config.get('@csl').styles.add('mla',fs.readFileSync(path.join(root,'assets/modern-language-association.csl'),'utf8'));
function citation(d,page){
  const missing=['author','title','year'].filter(k=>!d[k]);if(['article-journal','paper-conference','chapter'].includes(d.citationType)&&!d.publication)missing.push('publication');if(['book','chapter','report'].includes(d.citationType)&&!d.publisher)missing.push('publisher');if(d.citationType==='webpage'&&!d.url)missing.push('url');
  const author=(d.author||'').split(';').map(s=>s.trim()).filter(Boolean).map(s=>s.includes(',')?{family:s.split(',')[0].trim(),given:s.split(',').slice(1).join(',').trim()}:{literal:s});
  const data={id:d.id,type:d.citationType||'article-journal',title:d.title,author,'container-title':d.publication,publisher:d.publisher,volume:d.volume,issue:d.issue,page:d.pages,DOI:d.doi,URL:d.url};
  if(/^\d{4}$/.test(d.year))data.issued={'date-parts':[[Number(d.year)]]};
  if(/^\d{4}-\d{2}-\d{2}$/.test(d.accessed||''))data.accessed={'date-parts':[d.accessed.split('-').map(Number)]};
  const cite=new Cite(data);const options={format:'text',template:'mla',lang:'en-US'};
  const inText=cite.format('citation',{...options,entry:[{id:d.id,...(page?{locator:String(page),label:'page'}:{})}]});
  return {worksCited:cite.format('bibliography',options).trim(),inText,missing,reviewed:d.reviewed};
}
app.get('/api/documents/:id/citation',(req,res)=>{const doc=requireDoc(req.params.id),pdfPage=req.query.page?Number(req.query.page):null;if(pdfPage!==null&&(!Number.isInteger(pdfPage)||pdfPage<1||pdfPage>doc.pageCount))throw new Error('Invalid PDF page');const label=pdfPage?db.prepare('SELECT label FROM pages WHERE doc_id=? AND number=?').get(doc.id,pdfPage)?.label:null;res.json({...citation(doc,label),pdfPage,pageLabel:label||null});});
app.get('/api/export',(req,res)=>{
  const docs=rows('documents').filter(d=>!req.query.docId||d.id===req.query.docId),notes=rows('annotations');
  let md='# Quiet Margin — reading notes\n\nExported '+now()+'\n\n';
  for(const d of docs){const c=citation(d);md+=`## ${d.title}\n\n${c.worksCited}\n\nMetadata: ${d.reviewed?'reviewed':'not reviewed'}. ${c.missing.length?'Missing: '+c.missing.join(', '):''}\n\n`;for(const n of notes.filter(n=>n.docId===d.id)){md+=`### ${n.page?`PDF page ${n.page}${n.pageLabel?` · printed label ${n.pageLabel}`:" · printed label unavailable"}`:'Document note'}\n\nAnnotation ID: ${n.id}\nCreated: ${n.createdAt} · Updated: ${n.updatedAt}\n\n`;if(n.quote)md+='**Author quotation**\n\n> '+n.quote.replace(/\n/g,'\n> ')+'\n\n';md+='**My thought**\n\n'+(n.comment||'(No written comment)')+'\n\n';if(n.transcript)md+='**My audio transcript (current)**\n\n'+n.transcript+'\n\n';if(n.originalTranscript)md+='**Original provider transcript**\n\n'+n.originalTranscript+'\n\n';if(n.transcriptHistory?.length){md+='**Previous transcript versions**\n\n';for(const v of n.transcriptHistory)md+=v.savedAt+' — '+v.reason+'\n\n'+v.text+'\n\n';}if(n.audioFile)md+=`Recording: files/${n.audioFile} (included in a library backup)\n\n`;if(n.tags.length)md+='Tags: '+n.tags.join(', ')+'\n\n';md+='Suggested citation: '+citation(d,n.pageLabel).inText+'\n\n';}}
  res.attachment('quiet-margin-notes.md').type('text/markdown').send(md);
});
app.get('/api/backup',(req,res)=>{
  const zip=new AdmZip(),documents=rows('documents'),annotations=rows('annotations');
  zip.addFile('library.json',Buffer.from(JSON.stringify({version:1,createdAt:now(),documents,annotations,pages:db.prepare('SELECT * FROM pages').all(),workspace:state('workspace')},null,2)));
  for(const f of [...documents.map(d=>d.file),...annotations.map(n=>n.audioFile).filter(Boolean)])zip.addLocalFile(filePath(f),'files');
  res.attachment('quiet-margin-backup.zip').type('application/zip').send(zip.toBuffer());
});
app.post('/api/restore',upload.single('backup'),(req,res)=>{
  if(!req.file)return res.status(400).json({error:'Choose a Quiet Margin backup ZIP (up to 100 MB).'});
  const zip=new AdmZip(req.file.buffer), entries=zip.getEntries();
  if(entries.length>20000||entries.reduce((n,e)=>n+e.header.size,0)>1024*1024*1024)throw new Error('Backup exceeds restore limits');
  for(const e of entries)if(e.entryName!=='library.json'&&!/^files\/[a-f0-9-]{36}\.(pdf|webm|ogg|mp4|wav|mp3|m4a)$/.test(e.entryName))throw new Error('Unexpected file in backup');
  const b=JSON.parse(zip.readAsText('library.json'));
  validateLibraryManifest(b);
  const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
  if(b.version!==1||!Array.isArray(b.documents)||!Array.isArray(b.annotations)||!Array.isArray(b.pages))throw new Error('Invalid library manifest');
  const ids=new Set(b.documents.map(d=>d.id));
  if(ids.size!==b.documents.length||b.documents.some(d=>!validId(d.id)||!Number.isInteger(d.pageCount)||d.pageCount<1||!Array.isArray(d.tags)||typeof d.title!=='string')||b.annotations.some(n=>!validId(n.id)||!ids.has(n.docId)||!Array.isArray(n.rects)||!Array.isArray(n.tags)||typeof n.quote!=='string'||(n.page!==null&&(!Number.isInteger(n.page)||n.page<1||n.page>b.documents.find(d=>d.id===n.docId).pageCount)))||b.pages.some(p=>!ids.has(p.doc_id)||typeof p.text!=='string'||typeof p.label!=='string'||!Number.isInteger(p.number)))throw new Error('Invalid backup records');
  const files=[...b.documents.map(d=>d.file),...b.annotations.map(n=>n.audioFile).filter(Boolean)];
  for(const f of files){filePath(f);if(!zip.getEntry('files/'+f))throw new Error('Backup is missing a stored file');}
  // Save a recovery copy before restoring a backup.
  const recovery=path.join(dataDir,'before-restore-'+Date.now());fs.mkdirSync(recovery);db.exec('PRAGMA wal_checkpoint(FULL)');fs.copyFileSync(path.join(dataDir,'library.sqlite'),path.join(recovery,'library.sqlite'));fs.cpSync(path.join(dataDir,'files'),path.join(recovery,'files'),{recursive:true});
  for(const f of files)fs.writeFileSync(filePath(f),zip.readFile('files/'+f));
  db.exec('BEGIN');try{db.exec('DELETE FROM annotations; DELETE FROM pages; DELETE FROM documents; DELETE FROM embeddings;');for(const d of b.documents)saveDoc(d);for(const p of b.pages)db.prepare('INSERT INTO pages VALUES(?,?,?,?)').run(p.doc_id,p.number,p.label,p.text);for(const n of b.annotations)saveNote(n);setState('workspace',b.workspace||{tabs:[],positions:{}});db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
  res.json({ok:true,documents:b.documents.length});
});
app.use(express.static(path.join(root,'dist'),{index:false}));
app.get('/',(req,res)=>res.sendFile(path.join(root,'dist/index.html')));
app.use((err,req,res,next)=>{res.status(err.status||400).json({error:err instanceof multer.MulterError?'Upload too large or invalid. Maximum PDF/backup size is 100 MB; audio is 25 MB.':str(err.message,1000)||'Request failed',...(err.providerStatus?{providerStatus:err.providerStatus,code:err.code,action:err.action,retryAfter:err.retryAfter}:{})});});
export const server=app.listen(port,'127.0.0.1',err=>{if(err)return;console.log(`Quiet Margin is ready at http://localhost:${port}`);});
server.on('error',err=>{console.error(err.code==='EADDRINUSE'?`Port ${port} is already in use. If Quiet Margin is running, open http://localhost:${port}. Otherwise choose another PORT in .env.`:'Could not start the local server. Check the port and data-folder permissions.');process.exitCode=1;});
process.on('SIGTERM',()=>server.close(()=>{db.close();process.exit(0);}));
