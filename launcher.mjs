import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.',import.meta.url)));
if(Number(process.versions.node.split('.')[0])<22){console.error('Quiet Margin requires Node.js 22.13 or newer (Node 24 recommended).');process.exit(1);}
await import('./build.mjs');
await import('./server/index.mjs');
