'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const path=require('node:path'),os=require('node:os'),http=require('node:http');
const saves=require('../integrations/mintbrew-ouncecake/saves.cjs');
const library=require('../integrations/mintbrew-ouncecake/save-library.cjs');
const {snapshotAll}=require('../integrations/mintbrew-ouncecake/save-collection.cjs');
const server=require('../integrations/mintbrew-ouncecake/save-server.cjs');
const id='0400123456780000',uninstalled='0400123456790000',uid='00112233445566778899aabbccddeeff';
const archive=(n,titleId=id)=>({id:String(n),space:1,type:1,rank:0,index:0,uid,titleId,userName:'Player',titleName:'A game'});
async function temp(t){const folder=await fs.mkdtemp(path.join(os.tmpdir(),'save-library-'));t.after(()=>fs.rm(folder,{recursive:true,force:true}));return folder;}
test('saved title names are queried by ID without requiring an installed game or mounting its content',async()=>{
 const calls=[],closed=[],buffer=Buffer.alloc(0x4000);buffer.write('Uninstalled game');
 const s={base:0x100000,async write(){},async readOwned(){return buffer;},async close(h){closed.push(h);},async ipc(label,h,cmd,input){calls.push({cmd,input});return cmd===7989?{result:0,moves:[7]}:{result:0};}};
 const attachment={s,domain:{oneHandle:r=>r.moves[0]},async service(){return 6;}};
 const names=await library.titleNames({attachment,archives:[archive(1),archive(2,uninstalled)],knownEntries:[{titleId:id,name:'Installed game'}]});
 assert.equal(names.get(id),'Installed game');assert.equal(names.get(uninstalled),'Uninstalled game');
 assert.deepEqual(calls.map(c=>c.cmd),[7989,0]);assert.equal(calls[1].input.readBigUInt64LE(8),BigInt('0x'+uninstalled));assert.deepEqual(closed,[7]);
});
test('missing title names retain selectable ID groups, and every page stays within the GPU capacity',()=>{
 const all=Array.from({length:1200},(_,i)=>({...archive(i+1),titleId:i.toString(16).padStart(16,'0'),titleName:undefined}));
 const groups=library.groups(all);assert.equal(groups.length,1200);assert.equal(groups[0].name,'Unknown title');
 const rows=groups.map(g=>({saveGroup:g.titleId,name:g.name})),seen=new Set();
 for(let i=0;i<2;i++){const p=library.page(rows,{page:i,prefix:[{saveBatch:true}]});assert.ok(p.rows.length<=1001);for(const row of p.rows)if(row.saveGroup)seen.add(row.saveGroup);}
 assert.equal(seen.size,1200);
});
test('compressed Unicode control names decode within a bounded buffer',()=>{
 const titles=Buffer.alloc(0x3000);titles.write('パトリクのゲーム');const packed=require('node:zlib').deflateRawSync(titles),data=Buffer.alloc(0x4000);
 data.writeUInt16LE(packed.length);packed.copy(data,2);data[0x3215]=1;
 assert.equal(library.controlName(data),'パトリクのゲーム');data.writeUInt16LE(65535);assert.equal(library.controlName(data),undefined);
});
function toolsFor(archives,{denied,unsafe,cancelAfter}={}){
 let scans=0,copies=0;const attachment={s:{handles:new Set([1]),threads:new Set()}};
 const tools={...saves,async inventory(){scans++;return archives;},async snapshot({archive,directory,verifiedInventory}){
  assert.equal(verifiedInventory,archives);
  if(archive.id===denied)throw Object.assign(Error('Archive is already mounted'),{nativeResult:{canonical:0xe02}});
  if(archive.id===unsafe){attachment.s.handles.add(99);throw Object.assign(Error('Native cleanup uncertain'),{cleanupBlocked:true});}
  const folder=await fs.mkdtemp(path.join(directory,'archive-'));await fs.mkdir(path.join(folder,'files'));
  await fs.writeFile(path.join(folder,'files/slot.bin'),'abc');const sha256=await saves.hashFile(path.join(folder,'files/slot.bin'));
  const manifest={format:'mac2jb.save-backup',partial:false,selection:archive,files:1,bytes:3,directories:[],entries:[{path:'slot.bin',size:3,sha256}]};
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest));copies++;cancelAfter?.(copies);return {folder,manifest};
 }};
 return {tools,attachment,get scans(){return scans;}};
}
test('bulk backup includes uninstalled titles and keeps identical-profile archives in distinct paths',async t=>{
 const directory=await temp(t),archives=[archive(1),archive(2),archive(3,uninstalled)],f=toolsFor(archives);
 const backup=await snapshotAll({...f,archives,directory});assert.equal(f.scans,1);
 assert.equal(backup.manifest.archives.length,3);assert.equal(backup.manifest.saveFiles,3);assert.equal(backup.manifest.partial,false);
 assert.equal(new Set(backup.manifest.archives.map(a=>a.path)).size,3);
 assert.ok(backup.manifest.archives.some(a=>a.selection.titleId===uninstalled));
 for(const entry of backup.manifest.entries)assert.equal(await saves.hashFile(path.join(backup.folder,'files',entry.path)),entry.sha256);
});
test('busy archives are explicitly recorded as partial, while uncertain cleanup aborts the entire collection',async t=>{
 const directory=await temp(t),archives=[archive(1),archive(2)],f=toolsFor(archives,{denied:'2'});
 const backup=await snapshotAll({...f,archives,directory});assert.equal(backup.manifest.partial,true);assert.equal(backup.manifest.failed.length,1);assert.equal(backup.manifest.archives.length,1);
 const unsafeDir=await temp(t),unsafe=toolsFor(archives,{unsafe:'2'});
 await assert.rejects(snapshotAll({...unsafe,archives,directory:unsafeDir}),e=>e.cleanupBlocked===true);assert.deepEqual(await fs.readdir(unsafeDir),[]);
});
test('bulk cancellation removes the incomplete collection instead of publishing success',async t=>{
 const directory=await temp(t),archives=[archive(1),archive(2)];let cancelled=false;
 const f=toolsFor(archives,{cancelAfter:()=>{cancelled=true;}});
 await assert.rejects(snapshotAll({...f,archives,directory,shouldStop:()=>cancelled}),{code:'FTP_CANCELLED'});assert.deepEqual(await fs.readdir(directory),[]);
});
test('bulk export refuses auxiliary and system archives before any native backup starts',async t=>{
 const directory=await temp(t);
 for(const bad of [{...archive(1),type:5},{...archive(1),type:3,titleId:'0400000000001000'}]){
  const f=toolsFor([bad]);await assert.rejects(snapshotAll({...f,archives:[bad],directory}),/Only Account and Device game saves/);assert.equal(f.scans,0);
 }
 assert.deepEqual(await fs.readdir(directory),[]);
});
test('a changed archive index requires a fresh list instead of omitting new saves',async t=>{
 const directory=await temp(t),selected=[archive(1)],f=toolsFor([archive(1),archive(2)]);
 await assert.rejects(snapshotAll({...f,archives:selected,directory}),/inventory changed/);assert.deepEqual(await fs.readdir(directory),[]);
});
function get(url,method='GET'){return new Promise((resolve,reject)=>{const r=http.request(url,{method,headers:{Depth:'infinity'}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});r.on('error',reject);r.end();});}
test('HTTP and WebDAV expose every collection archive directly below its title/profile folders',async t=>{
 const directory=await temp(t),archives=[archive(1),archive(2,uninstalled)],f=toolsFor(archives);
 const backup=await snapshotAll({...f,archives,directory});const download=await server.start({...backup,name:'All Saves',address:'127.0.0.1',port:0});t.after(()=>download.close());
 const key='All Saves/'+backup.manifest.archives[1].path+'/files/slot.bin';
 assert.equal((await get(download.url+key.split('/').map(encodeURIComponent).join('/'))).body,'abc');
 const dav=await get(download.url,'PROPFIND');assert.equal(dav.status,207);assert.ok(dav.body.includes(uninstalled));
 assert.equal(JSON.parse((await get(download.url+'All%20Saves/manifest.json')).body).archives.length,2);
 await download.close();
});
test('an explicitly partial collection remains downloadable with its missing-archive manifest',async t=>{
 const directory=await temp(t),archives=[archive(1),archive(2)],f=toolsFor(archives,{denied:'2'});
 const backup=await snapshotAll({...f,archives,directory});
 const download=await server.start({...backup,name:'All Saves (partial)',address:'127.0.0.1',port:0});t.after(()=>download.close());
 const manifest=JSON.parse((await get(download.url+'All%20Saves%20(partial)/manifest.json')).body);
 assert.equal(manifest.partial,true);assert.equal(manifest.failed[0].selection.id,'2');assert.equal(manifest.archives.length,1);await download.close();
});
