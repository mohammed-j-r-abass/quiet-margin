import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
const build=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build'],{stdio:'inherit'});
if(build.status!==0)process.exit(build.status||1);
for(const dir of ['cmaps','standard_fonts','wasm'])fs.cpSync('node_modules/pdfjs-dist/'+dir,'dist/pdf-assets/'+dir,{recursive:true});
