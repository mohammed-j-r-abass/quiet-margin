import {readingPreferences} from '../shared/reading-preferences.mjs';
import {normalizeReadingPosition} from '../shared/reading-position.mjs';
const audioTypes=new Set(['audio/webm','video/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg','audio/x-wav']);
const id=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
const strings=value=>Array.isArray(value)&&value.every(t=>typeof t==='string');
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const fail=()=>{throw new Error('The backup contains invalid library records. The current library has not been replaced.');};
export function validateLibraryManifest(b){
  if(b?.version!==1||!Array.isArray(b.documents)||!Array.isArray(b.annotations)||!Array.isArray(b.pages))fail();
  const docs=new Map();
  for(const d of b.documents){
    if(!id(d.id)||docs.has(d.id)||typeof d.title!=='string'||!Number.isInteger(d.pageCount)||d.pageCount<1||d.pageCount>3000||!strings(d.tags)||!timestamp(d.createdAt)||!timestamp(d.updatedAt)||!Array.isArray(d.scannedPages)||!d.scannedPages.every(n=>Number.isInteger(n)&&n>=1&&n<=d.pageCount)||typeof d.file!=='string'||!d.file.endsWith('.pdf'))fail();
    for(const k of ['author','publication','year','doi','url','publisher','volume','issue','pages','collection','citationType'])if(d[k]!==undefined&&typeof d[k]!=='string')fail();
    docs.set(d.id,d);
  }
  const seenPages=new Set();
  for(const p of b.pages){const d=docs.get(p.doc_id),key=p.doc_id+':'+p.number;if(!d||!Number.isInteger(p.number)||p.number<1||p.number>d.pageCount||seenPages.has(key)||typeof p.label!=='string'||typeof p.text!=='string')fail();seenPages.add(key);}
  if(b.pages.length!==b.documents.reduce((n,d)=>n+d.pageCount,0))fail();
  const notes=new Set();
  for(const n of b.annotations){
    const d=docs.get(n.docId);
    if(!id(n.id)||notes.has(n.id)||!d||typeof n.quote!=='string'||typeof n.comment!=='string'||typeof n.transcript!=='string'||!strings(n.tags)||!timestamp(n.createdAt)||!timestamp(n.updatedAt)||!Array.isArray(n.rects)||!['amber','sage','rose','blue'].includes(n.color)||(n.page!==null&&(!Number.isInteger(n.page)||n.page<1||n.page>d.pageCount)))fail();
    if(n.highlight!==undefined&&typeof n.highlight!=='boolean')fail();
    if(n.rects.some(r=>!r||!['x','y','w','h'].every(k=>Number.isFinite(r[k]))||r.x<0||r.y<0||r.x>1||r.y>1||r.w<=0||r.h<=0||r.w>1||r.h>1))fail();
    if(n.audioFile&&(!audioTypes.has(n.audioMime)||typeof n.audioFile!=='string'))fail();
    if(n.pageLabel!==null&&n.pageLabel!==undefined&&typeof n.pageLabel!=='string')fail();
    if(n.originalTranscript!==undefined&&typeof n.originalTranscript!=='string')fail();
    if(n.transcriptHistory!==undefined&&(!Array.isArray(n.transcriptHistory)||n.transcriptHistory.some(v=>typeof v.text!=='string'||!timestamp(v.savedAt)||typeof v.reason!=='string')))fail();
    n.anchor={prefix:typeof n.anchor?.prefix==='string'?n.anchor.prefix:'',suffix:typeof n.anchor?.suffix==='string'?n.anchor.suffix:'',start:Number(n.anchor?.start)||0,end:Number(n.anchor?.end)||0};
    notes.add(n.id);
  }
  const w=b.workspace||{},tabs=Array.isArray(w.tabs)?[...new Set(w.tabs.filter(t=>docs.has(t)))]:[],positions={};
  for(const [key,p]of Object.entries(w.positions||{})){const d=docs.get(key);if(d&&p&&typeof p==='object')positions[key]=normalizeReadingPosition(p,d.pageCount);}
  b.workspace={tabs,activeId:tabs.includes(w.activeId)?w.activeId:tabs.at(-1)||null,positions,theme:w.theme==='dark'?'dark':'light',...readingPreferences(w)};
}
