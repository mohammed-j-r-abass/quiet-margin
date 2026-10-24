import React,{memo,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {LoaderCircle} from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import {isHighlighted,mergeHighlightRects} from '../shared/annotations.mjs';
import {normalizeReadingPosition,offsetForReadingPosition} from '../shared/reading-position.mjs';
import './continuous-pdf.css';

// Find the saved quotation in a rendered PDF text layer.
function quoteRects(layer,paper,quote) {
  if(!layer||!quote)return [];
  const spans=[...layer.querySelectorAll('span')].filter(s=>s.firstChild?.nodeType===3);
  const text=spans.map(s=>s.textContent).join('');
  let index=text.indexOf(quote),length=quote.length;
  if(index<0){
    const mapping=[];let compact='';
    for(let i=0;i<text.length;i++)if(!/\s/.test(text[i])){mapping.push(i);compact+=text[i];}
    const needle=quote.replace(/\s/g,'').slice(0,160),match=needle?compact.indexOf(needle):-1;
    if(match>=0){index=mapping[match];length=mapping[match+needle.length-1]+1-index;}
  }
  if(index<0)return [];
  let offset=0,start,end;
  for(const span of spans){
    const size=span.textContent.length;
    if(!start&&offset+size>index)start={node:span.firstChild,offset:Math.max(0,index-offset)};
    if(offset+size>=index+length){end={node:span.firstChild,offset:Math.min(size,index+length-offset)};break;}
    offset+=size;
  }
  if(!start||!end)return [];
  const range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
  const box=paper.getBoundingClientRect();
  return [...range.getClientRects()].map(r=>({x:(r.x-box.x)/box.width,y:(r.y-box.y)/box.height,w:r.width/box.width,h:r.height/box.height}));
}

const emptyItems=[];
const PDFPage=memo(function PDFPage({pdf,number,label,pageCount,width,fallback,scroller,register,initialPage,notes,focus,showAnnotations,flash,onSelection,onSelectNote,onReady,onGeometryChange}) {
  const block=useRef(),paper=useRef(),canvas=useRef(),layer=useRef(),proxy=useRef();
  const [near,setNear]=useState(number===initialPage),[shape,setShape]=useState(fallback),[ready,setReady]=useState(false),[renderedWidth,setRenderedWidth]=useState(0),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  const previousAspect=useRef(fallback.height/fallback.width);
  const callbacks=useRef({onReady,onGeometryChange});callbacks.current={onReady,onGeometryChange};
  useLayoutEffect(()=>{register(number,block.current);return()=>register(number,null);},[number,register]);
  useLayoutEffect(()=>{const aspect=shape.height/shape.width;if(Math.abs(previousAspect.current-aspect)>.0001){previousAspect.current=aspect;callbacks.current.onGeometryChange();}},[shape.width,shape.height]);
  useEffect(()=>{
    const observer=new IntersectionObserver(entries=>setNear(entries[0].isIntersecting),{root:scroller.current,rootMargin:'1000px 400px'});
    observer.observe(block.current);return()=>observer.disconnect();
  },[scroller]);
  useEffect(()=>{
    if(!near){setReady(false);proxy.current?.cleanup();return;}
    let cancelled=false,renderTask,textLayer;
    const targetCanvas=canvas.current,targetLayer=layer.current;
    setReady(false);setError('');
    (async()=>{
      const page=await pdf.getPage(number);if(cancelled)return;proxy.current=page;
      const base=page.getViewport({scale:1});setShape({width:base.width,height:base.height});
      const viewport=page.getViewport({scale:width/base.width}),ratio=Math.min(window.devicePixelRatio||1,2,Math.sqrt(16000000/(viewport.width*viewport.height)));
      targetCanvas.width=Math.ceil(viewport.width*ratio);targetCanvas.height=Math.ceil(viewport.height*ratio);
      targetCanvas.style.width=viewport.width+'px';targetCanvas.style.height=viewport.height+'px';
      paper.current.style.setProperty('--scale-factor',viewport.scale);paper.current.style.setProperty('--total-scale-factor',viewport.scale);
      renderTask=page.render({canvasContext:targetCanvas.getContext('2d'),viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null});
      await renderTask.promise;if(cancelled)return;
      targetLayer.replaceChildren();const content=await page.getTextContent();if(cancelled)return;
      textLayer=new pdfjs.TextLayer({textContentSource:content,container:targetLayer,viewport});
      await textLayer.render();if(cancelled)return;
      setRenderedWidth(width);setReady(true);callbacks.current.onReady(number);
    })().catch(e=>{if(!cancelled&&e.name!=='RenderingCancelledException'&&e.name!=='AbortException')setError(e.message);});
    return()=>{cancelled=true;renderTask?.cancel();textLayer?.cancel();targetLayer?.replaceChildren();if(targetCanvas){targetCanvas.width=0;targetCanvas.height=0;}};
  },[pdf,number,width,near,retry]);
  // Save the selected text with its page and coordinates.
  function selected(){
    const selection=window.getSelection();
    if(!selection?.rangeCount||selection.isCollapsed){onSelection(null);return;}
    const range=selection.getRangeAt(0);
    if(!layer.current?.contains(range.startContainer)||!layer.current?.contains(range.endContainer)){onSelection(null);return;}
    const quote=selection.toString();if(!quote.trim())return;
    const box=paper.current.getBoundingClientRect(),bounds=range.getBoundingClientRect();
    const rects=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0).map(r=>({x:Math.max(0,(r.x-box.x)/box.width),y:Math.max(0,(r.y-box.y)/box.height),w:Math.min(1,r.width/box.width),h:Math.min(1,r.height/box.height)}));
    const before=range.cloneRange();before.selectNodeContents(layer.current);before.setEnd(range.startContainer,range.startOffset);
    const start=before.toString().length,all=layer.current.textContent;
    onSelection({quote,page:number,pageLabel:label||null,rects,anchor:{start,end:start+quote.length,prefix:all.slice(Math.max(0,start-100),start),suffix:all.slice(start+quote.length,start+quote.length+100)},toolbar:{left:Math.min(window.innerWidth-320,Math.max(12,bounds.x+bounds.width/2-150)),top:Math.max(60,bounds.y-52)}});
  }
  function hitNote(event){
    if(!showAnnotations||!window.getSelection()?.isCollapsed)return;
    const box=paper.current.getBoundingClientRect(),x=(event.clientX-box.x)/box.width,y=(event.clientY-box.y)/box.height;
    const hit=notes.find(n=>isHighlighted(n)&&mergeHighlightRects(n.rects).some(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h));
    if(hit)onSelectNote(hit);
  }
  return <section className="pdf-page-block" ref={block} data-page-number={number} style={{width}} aria-label={'PDF page '+number}>
    <div className="continuous-page-label"><span>PDF page <b>{number}</b> of {pageCount}</span>{label&&<span>Printed page <b>{label}</b></span>}</div>
    <div className="pdf-paper" ref={paper} data-page-number={number} data-rendered={near&&ready&&renderedWidth===width?'true':'false'} style={{width,height:width*shape.height/shape.width}} onMouseUp={selected} onClick={hitNote}>
      {near&&<><canvas ref={canvas}/><div ref={layer} className="textLayer"/></>}
      {(!near||!ready||renderedWidth!==width)&&<div className="pdf-page-placeholder">{error?<><p>Could not display PDF page {number}.</p><button className="secondary" onClick={()=>setRetry(r=>r+1)}>Try this page again</button></>:<><LoaderCircle size={18} className="spin"/><span>Preparing page {number}…</span></>}</div>}
      {showAnnotations&&<div className="highlight-layer">{notes.filter(isHighlighted).flatMap(n=>mergeHighlightRects(n.rects).map((r,i)=><button key={n.id+i} className={'highlight '+n.color+(focus?.id===n.id?' focused':'')} style={{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'}} title={n.comment||n.transcript||'Highlighted passage'} aria-label="Open attached thought" onClick={e=>{e.stopPropagation();onSelectNote(n);}}/>))}</div>}
      <div className="flash-layer">{flash.map((r,i)=><span className="passage-flash" key={i} style={{left:r.x*100+'%',top:r.y*100+'%',width:r.w*100+'%',height:r.h*100+'%'}}/>)}</div>
    </div>
  </section>;
});

// Render nearby pages and save the current reading position.
export default function ContinuousPDF({pdf,doc,pages,position,navigation,focus,notes,showAnnotations,onPosition,onSelection,onSelectNote,onError}) {
  const scroller=useRef(),content=useRef(),blocks=useRef(new Map());
  const callbacks=useRef({onPosition,onSelection,onError});callbacks.current={onPosition,onSelection,onError};
  const initial=useRef(normalizeReadingPosition(position,doc.pageCount)),anchor=useRef(initial.current),lastPage=useRef(initial.current.page);
  const restoring=useRef(false),restoreFrame=useRef(),scrollFrame=useRef(),persistTimer=useRef(),pendingFocus=useRef(),flashTimer=useRef();
  const [availableWidth,setAvailableWidth]=useState(700),[fallback,setFallback]=useState(null),[flash,setFlash]=useState({page:null,rects:[]});
  const register=useCallback((page,element)=>{if(element)blocks.current.set(page,element);else blocks.current.delete(page);},[]);
  const topOf=useCallback(element=>(content.current?.offsetTop||0)+element.offsetTop,[]);
  // Find the page that fills the largest part of the reader.
  const readAnchor=useCallback(()=>{
    const root=scroller.current;if(!root||!blocks.current.size)return anchor.current;
    let low=1,high=doc.pageCount;
    while(low<high){const mid=Math.ceil((low+high)/2),element=blocks.current.get(mid);if(element&&topOf(element)<=root.scrollTop+2)low=mid;else high=mid-1;}
    let active=low,largest=0;
    const bottom=root.scrollTop+root.clientHeight;
    for(let number=low;number<=doc.pageCount;number++){
      const element=blocks.current.get(number),top=topOf(element);
      if(top>=bottom)break;
      const visible=Math.max(0,Math.min(bottom,top+element.offsetHeight)-Math.max(root.scrollTop,top));
      if(visible>largest){active=number;largest=visible;}
    }
    const element=blocks.current.get(active),height=element?.offsetHeight||1;
    const scroll=Math.min(height,root.scrollTop-topOf(element));
    return {page:active,scroll,scrollRatio:scroll/height};
  },[doc.pageCount,topOf]);
  const publish=useCallback(()=>{callbacks.current.onPosition(anchor.current);},[]);
  const track=useCallback(()=>{
    if(restoring.current)return;
    anchor.current=readAnchor();
    if(lastPage.current!==anchor.current.page){lastPage.current=anchor.current.page;publish();}
    clearTimeout(persistTimer.current);persistTimer.current=setTimeout(publish,180);
  },[readAnchor,publish]);
  // Restore the page offset after zoom or layout changes.
  const restore=useCallback(value=>{
    const root=scroller.current,element=blocks.current.get(value.page);if(!root||!element)return;
    anchor.current={...value};restoring.current=true;cancelAnimationFrame(restoreFrame.current);
    root.scrollTop=topOf(element)+offsetForReadingPosition(value,element.offsetHeight);
    restoreFrame.current=requestAnimationFrame(()=>{restoring.current=false;track();});
  },[topOf,track]);
  const geometryChanged=useCallback(()=>restore(anchor.current),[restore]);
  const revealFocus=useCallback(()=>{
    const target=pendingFocus.current;if(!target||target.scrollToPassage===false)return;
    const block=blocks.current.get(target.page),paper=block?.querySelector('.pdf-paper');if(!paper)return;
    const ready=paper.dataset.rendered==='true',rects=target.rects?.length?target.rects:quoteRects(paper.querySelector('.textLayer'),paper,target.quote);
    const offset=rects.length?Math.max(0,paper.offsetTop+rects[0].y*paper.offsetHeight-100):0;
    restore({page:target.page,scroll:offset,scrollRatio:offset/(block.offsetHeight||1)});
    if(ready){
      pendingFocus.current=null;
      if(!target.id){clearTimeout(flashTimer.current);setFlash({page:target.page,rects:mergeHighlightRects(rects)});flashTimer.current=setTimeout(()=>setFlash({page:null,rects:[]}),1600);}
    }
  },[restore]);
  useEffect(()=>{
    let stopped=false;
    pdf.getPage(1).then(page=>{if(!stopped){const viewport=page.getViewport({scale:1});setFallback({width:viewport.width,height:viewport.height});}}).catch(e=>callbacks.current.onError(e.message));
    return()=>{stopped=true;};
  },[pdf]);
  useEffect(()=>{
    const observer=new ResizeObserver(entries=>setAvailableWidth(entries[0].contentRect.width));observer.observe(scroller.current);return()=>observer.disconnect();
  },[]);
  useLayoutEffect(()=>{if(fallback)restore(anchor.current);},[availableWidth,position.zoom,fallback,restore]);
  useEffect(()=>{if(fallback&&navigation)restore({page:navigation.page,scroll:0,scrollRatio:0});},[navigation,fallback,restore]);
  useEffect(()=>{
    if(!fallback||!focus||focus.docId!==doc.id||!focus.page||focus.scrollToPassage===false)return;
    pendingFocus.current=focus;revealFocus();
  },[focus,fallback,doc.id,revealFocus]);
  const pageReady=useCallback(number=>{
    // Wait for the text layer before jumping to the passage.
    requestAnimationFrame(()=>{if(pendingFocus.current?.page===number)revealFocus();});
  },[revealFocus]);
  useEffect(()=>()=>{clearTimeout(persistTimer.current);clearTimeout(flashTimer.current);cancelAnimationFrame(restoreFrame.current);cancelAnimationFrame(scrollFrame.current);},[]);
  const pageNotes=useMemo(()=>{const grouped=new Map();for(const note of notes){if(!grouped.has(note.page))grouped.set(note.page,[]);grouped.get(note.page).push(note);}return grouped;},[notes]);
  const width=Math.max(160,availableWidth-8)*(position.zoom||1);
  return <div className="pdf-scroller continuous-scroller" ref={scroller} onScroll={()=>{
    callbacks.current.onSelection(null);cancelAnimationFrame(scrollFrame.current);scrollFrame.current=requestAnimationFrame(track);
  }}>
    {!fallback?<div className="pdf-preparing"><LoaderCircle size={20} className="spin"/>Preparing your paper…</div>:<div className="pdf-pages" ref={content}>
      {Array.from({length:doc.pageCount},(_,index)=>{const number=index+1;return <PDFPage key={number} pdf={pdf} number={number} label={pages[number-1]?.label} pageCount={doc.pageCount} width={width} fallback={fallback} scroller={scroller} register={register} initialPage={initial.current.page} notes={pageNotes.get(number)||emptyItems} focus={focus} showAnnotations={showAnnotations} flash={flash.page===number?flash.rects:emptyItems} onSelection={onSelection} onSelectNote={onSelectNote} onReady={pageReady} onGeometryChange={geometryChanged}/>;})}
    </div>}
  </div>;
}
