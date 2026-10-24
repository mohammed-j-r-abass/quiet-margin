import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const web=process.argv.includes('--web'),out=web?'dist-web':'dist';
const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',out,'--base',web?(process.env.SITE_BASE_PATH||'/'):'/'],{stdio:'inherit',env:{...process.env,VITE_STORAGE:web?'browser':'server'}});
if(build.status!==0)process.exit(build.status||1);
for(const dir of ['cmaps','standard_fonts','wasm'])fs.cpSync('node_modules/pdfjs-dist/'+dir,out+'/pdf-assets/'+dir,{recursive:true});
if(web){
  const policy="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' https: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
  const html=fs.readFileSync(out+'/index.html','utf8').replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+policy+'"/><meta name="referrer" content="no-referrer"/>');
  fs.writeFileSync(out+'/index.html',html);
  fs.writeFileSync(out+'/.nojekyll','');
}
