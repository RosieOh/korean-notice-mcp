import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readDocument } from '../src/lib/documents.js';
const root=fileURLToPath(new URL('../data/raw/',import.meta.url));
const manifest=JSON.parse(await readFile(new URL('../benchmarks/sources.json',import.meta.url),'utf8'));
await mkdir(new URL('../data/parsed/',import.meta.url),{recursive:true});
const selected=process.argv.includes('--all')?manifest.documents:manifest.documents.filter(s=>manifest.pairs.find(p=>p.before===s.id||p.after===s.id).split==='development');
for(const source of selected){
  const doc=await readDocument(root,source.file,{parser:'rhwp'});
  await writeFile(new URL(`../data/parsed/${source.id}.json`,import.meta.url),JSON.stringify(doc,null,2));
  await writeFile(new URL(`../data/parsed/${source.id}.txt`,import.meta.url),doc.blocks.map(b=>`[${b.locator}] ${b.text}`).join('\n'));
  console.log(`${source.id}: ${doc.blocks.length} blocks, ${doc.blocks.reduce((n,b)=>n+b.text.length,0)} chars`);
}
