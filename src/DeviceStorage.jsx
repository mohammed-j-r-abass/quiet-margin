import React,{useEffect,useState} from 'react';
import {HardDrive,ShieldCheck,Download} from 'lucide-react';
import {downloadResource} from './api.mjs';
import './device-storage.css';

export default function DeviceStorage({onForget}) {
  const [status,setStatus]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  async function refresh(){
    const estimate=await navigator.storage?.estimate?.();
    const persistent=await navigator.storage?.persisted?.();
    setStatus({usage:estimate?.usage,quota:estimate?.quota,persistent});
  }
  useEffect(()=>{refresh().catch(()=>setMessage('Storage information is unavailable in this browser.'));},[]);
  return <section className="device-storage settings-section" aria-label="Device storage">
    <h3><HardDrive size={18}/>Saved on this device</h3>
    <p>Your PDFs, thoughts, highlights, and recordings are saved to this browser’s storage on your disk. No account or shared library database is used. Another device, browser, or browser profile starts with its own empty library.</p>
    {import.meta.env.VITE_WEB_ANALYTICS==='true'&&<p>Cloudflare Web Analytics counts website visits and page load performance without analytics cookies. Your PDFs, thoughts, recordings, and AI keys are excluded from these statistics. <a href="https://developers.cloudflare.com/web-analytics/about/" target="_blank" rel="noreferrer">About website statistics</a></p>}
    <p className="storage-warning">Anyone using this browser profile can open this library. Clearing site data, private browsing, device loss, or a browser cleanup can remove it. This version does not encrypt the library with an app password. Keep a backup file somewhere safe.</p>
    {status&&<div className="storage-meter"><span>{status.usage===undefined?'Usage unavailable':(status.usage/1024/1024).toFixed(1)+' MB used'}{status.quota?' · '+(status.quota/1024/1024/1024).toFixed(1)+' GB browser quota':''}</span><span><ShieldCheck size={14}/>{status.persistent?'Browser persistence granted':'Browser may reclaim storage'}</span></div>}
    <div className="storage-actions"><button type="button" className="secondary" disabled={busy||status?.persistent} onClick={async()=>{setBusy(true);try{const granted=await navigator.storage?.persist?.();setMessage(granted?'The browser granted persistent storage. Backups are still important.':'The browser did not grant persistence. Keep a backup file; the library can still be used.');await refresh();}catch{setMessage('Your browser could not grant persistence. Keep a backup file.');}finally{setBusy(false);}}}>Protect browser storage</button>
      <button type="button" className="secondary" onClick={()=>downloadResource('/backup').then(result=>{if(result)setMessage(result==='saved'?'Backup saved to the file you chose.':'Backup downloaded. Keep it somewhere safe.');}).catch(e=>setMessage(e.message))}><Download size={15}/>Save backup to disk</button>
      <button type="button" className="text-button" onClick={()=>downloadResource('/recovery-backup').catch(e=>setMessage(e.message))}>Save previous library after restore</button>
      <button type="button" className="text-button" onClick={async()=>{try{await onForget();setMessage('AI keys cleared from this tab. Saved library files are unchanged.');}catch(e){setMessage(e.message);}}}>Clear AI keys from this tab</button></div>
    {message&&<p role="status" className="storage-message">{message}</p>}
  </section>;
}
