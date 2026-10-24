import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import crypto from 'node:crypto';
import os from 'node:os';
import AdmZip from 'adm-zip';
import {createHighlightDraft} from '../shared/reading-preferences.mjs';

const root=path.resolve('.'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-margin-test-')),base='http://localhost:4318';
let server,token='',provider,providerPort,providerRequests=[],providerFails=false,providerQuota=false;
async function start(){server=spawn(process.execPath,['server/index.mjs'],{cwd:root,env:{...process.env,PORT:'4318',DATA_DIR:dir},stdio:['ignore','pipe','pipe']});let output='';server.stdout.on('data',b=>output+=b);server.stderr.on('data',b=>output+=b);for(let n=0;n<150;n++){try{const b=await (await fetch(base+'/api/bootstrap')).json();token=b.token;return b;}catch{if(server.exitCode!==null)throw new Error(output);await new Promise(r=>setTimeout(r,100));}}throw new Error('Server startup timed out: '+output);}
async function stop(){if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}}
async function api(route,method='GET',body,expected=200){const r=await fetch(base+'/api'+route,{method,headers:{'X-Library-Token':token,...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body instanceof FormData?body:body?JSON.stringify(body):undefined});const data=await r.json();assert.equal(r.status,expected,JSON.stringify(data));return data;}
async function upload(name){const f=new FormData();f.append('pdf',new Blob([fs.readFileSync('tests/fixtures/'+name)],{type:'application/pdf'}),name);return api('/documents','POST',f,201);}
function wav(){const size=16000*2,buffer=Buffer.alloc(44+size);buffer.write('RIFF');buffer.writeUInt32LE(36+size,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(16000,24);buffer.writeUInt32LE(32000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(size,40);for(let i=0;i<16000;i++)buffer.writeInt16LE(Math.sin(i/16000*Math.PI*880)*3000,44+i*2);return buffer;}

test('complete private library workflow, persistence, provider contracts, and recovery',async t=>{
  t.after(async()=>{await stop();if(provider)await new Promise(r=>provider.close(r));});
  await start();
  await t.test('reject cross-site writes and requests without CSRF token',async()=>{
    assert.equal((await fetch(base+'/api/workspace',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/config',{method:'PUT',headers:{Origin:'https://untrusted.example','X-Library-Token':token,'Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/data/secrets.json')).status,404);
  });
  let d1,d2,note,audio,backup;
  await t.test('import two real PDFs and extract page text',async()=>{d1=await upload('research-paper.pdf');d2=await upload('second-paper.pdf');assert.equal(d1.pageCount,14);assert.equal(d2.pageCount,1);const pages=await api('/documents/'+d1.id+'/pages');assert.match(pages[0].text,/Trace-based/);assert.equal(pages.length,14);const invalid=new FormData();invalid.append('pdf',new Blob(['not a pdf']),'bad.pdf');await api('/documents','POST',invalid,400);});
  await t.test('save exact quotation, separate comment, coordinates, anchors, and tags',async()=>{note=await api('/annotations','POST',{docId:d1.id,page:1,quote:'Dynamic languages such as JavaScript',comment:'I question whether the benchmark evidence supports this claim. The sample size seems small.',rects:[{x:.1,y:.3,w:.3,h:.02}],anchor:{prefix:'Abstract',suffix:'are more difficult',start:321,end:358},tags:['evidence','methodology'],color:'sage'},201);assert.equal(note.quote,'Dynamic languages such as JavaScript');assert.equal(note.rects[0].x,.1);assert.equal(note.anchor.prefix,'Abstract');assert.ok(note.createdAt);note=await api('/annotations/'+note.id,'PATCH',{...note,comment:note.comment+' Test note.'});assert.ok(note.updatedAt>=note.createdAt);});
  await t.test('highlighting is an independent, reversible choice and preserves the passage anchor',async()=>{
    assert.equal(note.highlight,false);
    const originalRects=note.rects,originalAnchor=note.anchor;
    note=await api('/annotations/'+note.id,'PATCH',{highlight:true});
    assert.equal(note.highlight,true);
    note=await api('/annotations/'+note.id,'PATCH',{comment:note.comment+' Still linked.'});
    assert.equal(note.highlight,true);
    note=await api('/annotations/'+note.id,'PATCH',{highlight:false});
    assert.equal(note.highlight,false);
    assert.deepEqual(note.rects,originalRects);
    assert.deepEqual(note.anchor,originalAnchor);
    assert.equal(note.quote,'Dynamic languages such as JavaScript');
    const highlight=await api('/annotations','POST',createHighlightDraft(d1.id,{page:1,quote:'An explicit highlight',rects:originalRects,anchor:originalAnchor},'blue'),201);
    assert.equal(highlight.highlight,true);assert.equal(highlight.color,'blue');assert.equal(highlight.comment,'');assert.deepEqual(highlight.anchor,originalAnchor);
    await api('/annotations/'+highlight.id,'DELETE');
  });
  await t.test('highlight source page and printed citation label come from the actual selected PDF page',async()=>{
    const labeled=await upload('continuous-pages.pdf');
    try{
      assert.equal(labeled.pageCount,4);
      const pages=await api('/documents/'+labeled.id+'/pages');
      assert.deepEqual(pages.map(p=>p.label),['101','102','103','104']);
      await api('/documents/'+labeled.id,'PATCH',{author:'Researcher, Example',year:'2026',publication:'Research notebook',publisher:'Quiet Margin Fixtures',citationType:'report',reviewed:true});
      const highlight=await api('/annotations','POST',{...createHighlightDraft(labeled.id,{page:2,quote:'Highlight this evidence on PDF page 2.',rects:[{x:.1,y:.12,w:.4,h:.02}],anchor:{start:0,end:38}},'amber'),pageLabel:'999'},201);
      assert.equal(highlight.page,2);
      assert.equal(highlight.pageLabel,'102');
      const cite=await api('/documents/'+labeled.id+'/citation?page=2');
      assert.equal(cite.pdfPage,2);
      assert.equal(cite.pageLabel,'102');
      assert.match(cite.inText,/Researcher 102/);
      const md=await(await fetch(base+'/api/export?docId='+labeled.id)).text();
      assert.match(md,/PDF page 2 · printed label 102/);
      assert.match(md,/Researcher 102/);
    }finally{await api('/documents/'+labeled.id,'DELETE');}
  });
  await t.test('metadata edit preserves page extraction and saved notes; CSL formats MLA',async()=>{d1=await api('/documents/'+d1.id,'PATCH',{title:'Trace-based Just-in-Time Type Specialization for Dynamic Languages',author:'Gal, Andreas; Eich, Brendan',publication:'Proceedings of PLDI',year:'2009',reviewed:true,tags:['compilers'],citationType:'paper-conference'});assert.equal((await api('/documents/'+d1.id+'/pages')).length,14);assert.equal((await api('/bootstrap')).annotations.length,1);const c=await api('/documents/'+d1.id+'/citation?page=1');assert.match(c.worksCited,/Gal/);assert.match(c.worksCited,/2009/);assert.doesNotMatch(c.inText,/1/);assert.equal(d1.hasPageLabels,false);assert.deepEqual(c.missing,[]);assert.equal(c.reviewed,true);});
  await t.test('save and replay original audio bytes without transcription',async()=>{audio=wav();const form=new FormData();form.append('audio',new Blob([audio],{type:'audio/wav'}),'thought.wav');note=await api('/annotations/'+note.id+'/audio','POST',form);assert.ok(note.audioFile);const r=await fetch(base+'/api/annotations/'+note.id+'/audio');assert.equal(r.status,200);assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),crypto.createHash('sha256').update(audio).digest('hex'));await api('/annotations/'+note.id+'/transcribe','POST',undefined,400);assert.ok((await api('/bootstrap')).annotations[0].audioFile);});
  await t.test('ordinary search returns real annotation; export includes exact source and thought',async()=>{const r=await api('/search?q=sample%20size');assert.equal(r.evidence[0].id,note.id);assert.equal(r.evidence[0].page,1);const missing=await api('/search?q=quasarxyz');assert.equal(missing.evidence.length,0);const md=await (await fetch(base+'/api/export')).text();assert.match(md,/Dynamic languages such as JavaScript/);assert.match(md,/sample size/);assert.match(md,/PDF page 1/);assert.match(md,/2009/);const noKey=await api('/chat','POST',{query:'sample size'});assert.equal(noKey.statements.length,0);assert.match(noKey.message,/Configure/);});
  await t.test('two tabs and positions survive a full backend restart',async()=>{await api('/workspace','PUT',{tabs:[d1.id,d2.id],activeId:d1.id,positions:{[d1.id]:{page:2,zoom:1.2,scroll:120,scrollRatio:.075},[d2.id]:{page:1,zoom:1}},theme:'dark',readerSidebar:false,readerExpanded:true,highlightColor:'rose'});await stop();const b=await start();assert.equal(b.documents.length,2);assert.equal(b.annotations.length,1);assert.equal(b.annotations[0].quote,note.quote);assert.equal(b.annotations[0].highlight,false);assert.equal(b.workspace.tabs.length,2);assert.equal(b.workspace.positions[d1.id].scrollRatio,.075);assert.equal(b.workspace.readerSidebar,false);assert.equal(b.workspace.readerExpanded,true);assert.equal(b.workspace.highlightColor,'rose');assert.equal(b.workspace.positions[d1.id].page,2);assert.equal(b.workspace.positions[d1.id].scroll,120);assert.ok(fs.existsSync(path.join(dir,'files',b.annotations[0].audioFile)));});
  await t.test('OpenAI-compatible embeddings, grounded responses, transcription and corrections (local contract provider)',async()=>{
    provider=http.createServer(async(req,res)=>{let bytes=[];for await(const chunk of req)bytes.push(chunk);const text=Buffer.concat(bytes).toString();providerRequests.push({url:req.url,text,authorization:req.headers.authorization});res.setHeader('Content-Type','application/json');if(providerQuota&&req.url.includes('chat/completions')){res.statusCode=429;return res.end(JSON.stringify({error:{code:'credit_balance_exhausted',type:'insufficient_quota',message:'Secret test-only-key should never be echoed'}}));}if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'contract-chat'},{id:'custom-other'}]}));if(providerFails){res.statusCode=503;return res.end('{"error":"temporary"}');}if(req.url==='/v1/embeddings'){const b=JSON.parse(text);return res.end(JSON.stringify({data:b.input.map((s,index)=>({index,embedding:/benchmark|sample|evidence|supports|disagree/i.test(s)?[1,0,0]:[0,1,0]}))}));}if(req.url==='/v1/audio/transcriptions')return res.end(JSON.stringify({text:'Original transcript: I am uncertain about the sample size.'}));if(req.url==='/v1/chat/completions'){const b=JSON.parse(text);if(b.messages.length===1)return res.end(JSON.stringify({choices:[{message:{content:'OK'}}]}));if(b.messages[0].content.startsWith('Select saved')){const sources=JSON.parse(b.messages[1].content).sources;return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({matches:[{id:sources[0].id,score:.95},{id:'invented-id',score:1}]})}}]}));}const evidence=JSON.parse(b.messages[1].content).evidence;assert.match(b.messages[0].content,/untrusted SOURCE DATA/);return res.end(JSON.stringify({choices:[{message:{content:JSON.stringify({statements:[{text:'The reader questions the benchmark evidence.',source_ids:[evidence[0].id]},{text:'Invented unsupported claim',source_ids:['fake-id']}]})}}]}));}res.statusCode=404;res.end('{}');});
    await new Promise(r=>provider.listen(0,'127.0.0.1',r));providerPort=provider.address().port;
    const c=await api('/config','PUT',{endpoint:`http://127.0.0.1:${providerPort}/v1`,apiKey:'test-only-key',chatModel:'contract-chat',embeddingModel:'contract-embedding',transcriptionModel:'contract-transcribe'});assert.equal(c.hasApiKey,true);assert.equal(c.apiKey,undefined);assert.doesNotMatch(JSON.stringify(await api('/bootstrap')),/test-only-key/);
    const r=await api('/chat','POST',{query:'Where did I disagree with the evidence?',docIds:[d1.id],includeFullText:false});assert.equal(r.mode,'semantic');assert.equal(r.statements.length,1);assert.equal(r.statements[0].source_ids[0],note.id);assert.equal(r.evidence[0].quote,note.quote);assert.ok(providerRequests.every(r=>r.authorization==='Bearer test-only-key'));assert.ok(providerRequests.filter(r=>r.url.includes('embeddings')).every(r=>!r.text.includes('Permission to make digital')));
    note=await api('/annotations/'+note.id+'/transcribe','POST');assert.match(note.originalTranscript,/Original transcript/);note=await api('/annotations/'+note.id,'PATCH',{...note,transcript:'Corrected: I question the statistical power.'});assert.match(note.originalTranscript,/Original transcript/);assert.match((await api('/search?q=statistical')).evidence[0].transcript,/statistical/);note=await api('/annotations/'+note.id+'/transcribe','POST');assert.ok(note.transcriptHistory.some(v=>v.text.includes('statistical power')));assert.match(note.originalTranscript,/Original transcript/);note=await api('/annotations/'+note.id,'PATCH',{...note,transcript:'Corrected: I question the statistical power.'});
    const full=await api('/chat','POST',{query:'benchmark evidence',docIds:[d1.id],includeFullText:true});assert.ok(full.evidence.some(s=>s.kind==='document'));providerFails=true;await api('/annotations/'+note.id+'/transcribe','POST',undefined,400);assert.ok((await api('/bootstrap')).annotations[0].audioFile);providerFails=false;
  });
  await t.test('model discovery, custom model selection, and semantic retrieval without an embedding model',async()=>{
    const listed=await api('/provider/models','POST',{});assert.deepEqual(listed.models,['contract-chat','custom-other']);
    const probe=await api('/provider/test','POST',{chatModel:'custom-other'});assert.equal(probe.ok,true);assert.equal(probe.model,'custom-other');
    const before=(await api('/bootstrap')).config.chatModel;assert.equal(before,'contract-chat');
    await api('/config','PUT',{chatModel:'custom-other',embeddingModel:''});
    const result=await api('/chat','POST',{query:'Do any concerns undermine the reliability of the work?',docIds:[d1.id]});assert.equal(result.mode,'model');assert.equal(result.evidence[0].id,note.id);assert.equal(result.statements[0].source_ids[0],note.id);assert.equal(JSON.parse(providerRequests.at(-1).text).model,'custom-other');
    providerQuota=true;const failure=await api('/provider/test','POST',{},400);assert.equal(failure.action,'billing');assert.equal(failure.code,'credit_balance_exhausted');assert.match(failure.error,/billing/);assert.doesNotMatch(failure.error,/test-only-key/);providerQuota=false;
    await api('/config','PUT',{chatModel:'contract-chat',embeddingModel:'contract-embedding'});
  });
  await t.test('backup restores documents, annotations, transcripts, audio, and workspace; excludes keys',async()=>{backup=Buffer.from(await(await fetch(base+'/api/backup')).arrayBuffer());const zip=new AdmZip(backup);assert.ok(zip.getEntry('library.json'));assert.equal(zip.getEntries().some(e=>e.entryName.includes('secret')),false);assert.doesNotMatch(zip.readAsText('library.json'),/test-only-key/);await api('/documents/'+d2.id,'DELETE');assert.equal((await api('/bootstrap')).documents.length,1);const form=new FormData();form.append('backup',new Blob([backup]),'backup.zip');await api('/restore','POST',form);const b=await api('/bootstrap');assert.equal(b.documents.length,2);assert.equal(b.annotations.length,1);assert.match(b.annotations[0].transcript,/statistical/);assert.equal(b.annotations[0].highlight,false);assert.equal(b.workspace.tabs.length,2);assert.equal(b.workspace.positions[d1.id].scrollRatio,.075);assert.equal(b.workspace.readerSidebar,false);assert.equal(b.workspace.readerExpanded,true);assert.equal(b.workspace.highlightColor,'rose');assert.equal(b.config.hasApiKey,true);assert.ok(fs.readdirSync(dir).some(f=>f.startsWith('before-restore-')));const replay=Buffer.from(await(await fetch(base+'/api/annotations/'+note.id+'/audio')).arrayBuffer());assert.deepEqual(replay,audio);});
  await t.test('reject malformed backup paths and preserve library',async()=>{const zip=new AdmZip();zip.addFile('outside.txt',Buffer.from('bad'));zip.addFile('library.json',Buffer.from('{}'));const form=new FormData();form.append('backup',new Blob([zip.toBuffer()]),'bad.zip');await api('/restore','POST',form,400);assert.equal((await api('/bootstrap')).documents.length,2);});
  await t.test('delete recording and annotation independently',async()=>{note=await api('/annotations/'+note.id+'/audio','DELETE');assert.equal(note.audioFile,undefined);assert.match(note.transcript,/statistical/);await api('/annotations/'+note.id,'DELETE');assert.equal((await api('/bootstrap')).annotations.length,0);});
});
