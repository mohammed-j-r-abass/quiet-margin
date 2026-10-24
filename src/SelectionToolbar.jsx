import React,{useRef,useState} from 'react';
import {ChevronDown,Check,Edit3,Highlighter,LoaderCircle,Mic} from 'lucide-react';
import {highlightColors} from '../shared/reading-preferences.mjs';
import './selection-toolbar.css';

export default function SelectionToolbar({selection,color,onHighlight,onThought,onVoice,onError}) {
  const [paletteOpen,setPaletteOpen]=useState(false),[busy,setBusy]=useState(false);
  const saving=useRef(false);
  async function highlight(chosen=color) {
    if(saving.current)return;
    saving.current=true;setBusy(true);
    try{await onHighlight(chosen);}catch(e){onError(e.message);}
    finally{saving.current=false;setBusy(false);}
  }
  return <div className="selection-toolbar" role="toolbar" aria-label="Selected passage actions"
    style={{left:selection.toolbar.left,top:selection.toolbar.top}}
    onMouseDown={e=>e.preventDefault()}
    onKeyDown={e=>{if(e.key==='Escape'){setPaletteOpen(false);e.stopPropagation();}}}>
    <div className="quick-highlight" onMouseEnter={()=>setPaletteOpen(true)} onMouseLeave={()=>setPaletteOpen(false)}
      onFocus={()=>setPaletteOpen(true)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setPaletteOpen(false);}}>
      <button type="button" className="highlight-apply" aria-label="Highlight" disabled={busy} onClick={()=>highlight()}>
        {busy?<LoaderCircle size={16} className="spin"/>:<Highlighter size={16}/>}
        Highlight<span className="current-highlight-color" style={{background:highlightColors.find(c=>c.id===color)?.fill}}/>
      </button>
      <button type="button" className="highlight-color-toggle" aria-label="Choose highlight color" aria-expanded={paletteOpen}
        disabled={busy} onClick={()=>setPaletteOpen(true)}><ChevronDown size={13}/></button>
      {paletteOpen&&<div className={'highlight-colors'+(selection.toolbar.top>window.innerHeight-156?' above':'')} role="group" aria-label="Highlight colors"><div className="highlight-colors-inner">
        <span>Highlight color</span><div>{highlightColors.map(c=><button type="button" key={c.id} className="quick-color"
          aria-label={c.label+' highlight'} aria-pressed={color===c.id} disabled={busy} onClick={()=>highlight(c.id)}>
          <i style={{background:c.fill}}>{color===c.id&&<Check size={12}/>}</i><small>{c.label}</small>
        </button>)}</div>
      </div></div>}
    </div>
    <button type="button" disabled={busy} onClick={onThought}><Edit3 size={16}/>Thought</button>
    <button type="button" disabled={busy} onClick={onVoice}><Mic size={16}/>Voice</button>
  </div>;
}
