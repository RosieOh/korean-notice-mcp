import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base=new URL('../',import.meta.url);
const manifest=JSON.parse(await readFile(new URL('benchmarks/sources.json',base),'utf8'));
const directory=new URL('data/raw/',base);
await mkdir(directory,{recursive:true});
let locked={};try{locked=JSON.parse(await readFile(new URL('benchmarks/checksums.json',base),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const results={};
for(const source of manifest.documents){
  const url=new URL(source.download_url);
  if(url.protocol!=='https:'||url.hostname!=='www.jangsu.go.kr'||!/^[a-z0-9-]+\.(hwp|hwpx)$/.test(source.file))throw new Error('Source outside fixed corpus');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`${source.id}: HTTP ${response.status}`);
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>2*1024*1024)throw new Error('Download exceeds 2MB');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  const magic=bytes.subarray(0,8).toString('hex');
  if(!(source.file.endsWith('.hwpx')?magic.startsWith('504b0304'):magic==='d0cf11e0a1b11ae1'))throw new Error(`${source.id}: unexpected content, magic=${magic}, bytes=${bytes.length}, type=${response.headers.get('content-type')}`);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  if(locked[source.id]&&locked[source.id].sha256!==sha256)throw new Error(`${source.id}: original has changed; review and explicitly update checksum`);
  await writeFile(new URL(source.file,directory),bytes);
  results[source.id]={sha256,bytes:bytes.length};
  console.log(`${source.id}: ${bytes.length} bytes`);
}
await writeFile(new URL('benchmarks/checksums.json',base),JSON.stringify(results,null,2)+'\n');
await writeFile(new URL('data/fetched.json',base),JSON.stringify({retrieved_at:new Date().toISOString(),documents:results},null,2)+'\n');
