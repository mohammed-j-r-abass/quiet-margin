import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import analytics from './web-analytics.json' with {type:'json'};
import {analyticsToken,webDocument} from './build-web.mjs';
const web=process.argv.includes('--web'),out=web?'dist-web':'dist';
const token=analyticsToken(web,process.env.CLOUDFLARE_WEB_ANALYTICS_TOKEN??analytics.cloudflareToken);
const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--outDir',out,'--base',web?(process.env.SITE_BASE_PATH||'/'):'/'],{stdio:'inherit',env:{...process.env,VITE_STORAGE:web?'browser':'server',VITE_WEB_ANALYTICS:token?'true':'false'}});
if(build.status!==0)process.exit(build.status||1);
for(const dir of ['cmaps','standard_fonts','wasm'])fs.cpSync('node_modules/pdfjs-dist/'+dir,out+'/pdf-assets/'+dir,{recursive:true});
const notices=['Quiet Margin uses the following open-source libraries. Their licenses apply to those libraries.'];
for(const name of ['react','react-dom','pdfjs-dist','lucide-react','fflate','citeproc','@citation-js/core','@citation-js/plugin-csl']){
  const folder='node_modules/'+name,metadata=JSON.parse(fs.readFileSync(folder+'/package.json','utf8'));
  notices.push(name+' '+metadata.version+'\nLicense: '+metadata.license+'\n'+(metadata.homepage||metadata.repository?.url||''));
  for(const file of fs.readdirSync(folder).filter(file=>/^licen[cs]e(?:\.|$)|^copying(?:\.|$)/i.test(file)))if(fs.statSync(folder+'/'+file).isFile())notices.push(fs.readFileSync(folder+'/'+file,'utf8'));
}
notices.push('CSL Modern Language Association style and locale data: CC BY-SA 3.0. See https://creativecommons.org/licenses/by-sa/3.0/ and https://github.com/citation-style-language/styles.','citeproc-js source: https://github.com/Juris-M/citeproc-js\nCPAL 1.0: https://opensource.org/license/cpal_1-0');
fs.writeFileSync(out+'/third-party-notices.txt',notices.join('\n\n--------------------\n\n'));
if(web){
  const html=webDocument(fs.readFileSync(out+'/index.html','utf8'),token);
  fs.writeFileSync(out+'/index.html',html);
  fs.writeFileSync(out+'/.nojekyll','');
}
