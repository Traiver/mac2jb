'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises');
const os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const saves=require('../integrations/mintbrew-ouncecake/saves.cjs');
const server=require('../integrations/mintbrew-ouncecake/save-server.cjs');
const {dispatchServiceRequest}=require('../vendor/MintBrew/homebrew-launcher/app-runtime.cjs');
const titleId='0400123456780000',uid='00112233445566778899aabbccddeeff';
const archive={id:'123',space:1,type:1,rank:0,index:2,uid,titleId,size:'4096'};
function record(a=archive){const b=Buffer.alloc(0x60);b.writeBigUInt64LE(BigInt(a.id));b[8]=a.space;b[9]=a.type;b[10]=a.rank;b.writeUInt32LE(a.index,12);Buffer.from(a.uid,'hex').copy(b,16);b.writeBigUInt64LE(BigInt('0x'+a.titleId),40);b.writeBigUInt64LE(BigInt(a.size),48);return b;}
async function directory(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'ouncecake-saves-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
function attached({short=false,closeError=false,count=1,rows,recordBytes=record()}={}){
 const calls=[],closed=[];let next=10,space;
 const s={base:0x100000,handles:new Set([1]),threads:new Set(),async write(){},
  async ipc(label,handle,cmd,input){calls.push({label,handle,cmd,input});
   if(cmd===61){space=input[0];const h=next++;s.handles.add(h);return {result:0,moves:[h],copies:[]};}
   if(cmd===53){const h=next++;s.handles.add(h);return {result:0,moves:[h],copies:[]};}
   assert.equal(cmd,0);const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt(space===1?count:0));return {result:0,data};
  },async read(){return recordBytes;},async close(h){if(closeError)throw Error('close failed');s.handles.delete(h);closed.push(h);}};
 const filesystem={async listDirectory(s,h,remote){return rows|| (remote==='/'?[{name:'データ',type:0},{name:'manifest.json',type:1,size:'3'}]:[{name:'slot.bin',type:1,size:'3'},{name:'empty',type:1,size:'0'}]);},
  async openFile(){const h=next++;s.handles.add(h);return {result:0,handle:h};},async fileSize(s,h){return h===14?0n:3n;},
  async readFile(s,h,offset,amount){return Buffer.from('abc').subarray(0,short?1:amount);}};
 // Size follows the file path, not a particular allocation order.
 const sizes=new Map();filesystem.openFile=async(s,h,p)=>{const file=next++;s.handles.add(file);sizes.set(file,p.endsWith('/empty')?0n:3n);return {result:0,handle:file};};
 filesystem.fileSize=async(s,h)=>sizes.get(h);
 return {attachment:{s,root:1,domain:{oneHandle:r=>r.moves[0]},filesystem},calls,closed};
}
test('save inventory preserves exact UID and archive selection, closes readers, and filters other titles',async()=>{
 const f=attached();assert.deepEqual(await saves.inventory({...f,titleId}),[archive]);
 assert.deepEqual([...f.attachment.s.handles],[1]);assert.deepEqual(f.calls.map(c=>c.cmd),[61,0,61,0]);
 const other=attached({recordBytes:record({...archive,titleId:'0000000000000001'})});
 assert.deepEqual(await saves.inventory({...other,titleId}),[]);
});
test('save inventory rejects corrupt counts and space mismatches without leaking a handle',async()=>{
 for(const options of [{count:65},{recordBytes:record({...archive,space:4})}]){
  const f=attached(options);await assert.rejects(saves.inventory({...f,titleId}),/count|space/);assert.deepEqual([...f.attachment.s.handles],[1]);
 }
});
test('unfiltered FS inventory includes saves for titles absent from the installed game catalog',async()=>{
 const removed={...archive,id:'124',titleId:'0400123456790000'};
 const f=attached({count:2,recordBytes:Buffer.concat([record(archive),record(removed)])});
 const all=await saves.inventory({...f});assert.deepEqual(new Set(all.map(a=>a.titleId)),new Set([archive.titleId,removed.titleId]));
 assert.deepEqual([...f.attachment.s.handles],[1]);assert.ok(f.calls.every(c=>[61,0].includes(c.cmd)));
});
test('an absent SD card preserves NAND saves; other SD errors never become an empty success',async()=>{
 for(const result of [0x8ed37e02,0x320002]){
  const f=attached(),original=f.attachment.s.ipc;
  f.attachment.s.ipc=async(...args)=>args[2]===61&&args[3][0]===4?{result,moves:[],copies:[]}:original(...args);
  if(result===0x8ed37e02)assert.deepEqual(await saves.inventory({...f,titleId}),[archive]);
  else await assert.rejects(saves.inventory({...f,titleId}),/Open save archive index/);
  assert.deepEqual([...f.attachment.s.handles],[1]);
 }
});
test('save index cancellation closes the owned reader; failed cleanup is marked unsafe',async()=>{
 const f=attached();let stops=0;
 await assert.rejects(saves.inventory({...f,titleId,shouldStop:()=>++stops>1}),{code:'FTP_CANCELLED'});assert.deepEqual([...f.attachment.s.handles],[1]);
 const unsafe=attached({count:65,closeError:true});await assert.rejects(saves.inventory({...unsafe,titleId}),error=>error.errors.some(e=>e.cleanupBlocked));
});
test('save snapshot contains every file including empty files, verifies hashes, and only opens command 53',async t=>{
 const folder=await directory(t),f=attached();
 const result=await saves.snapshot({...f,archive,directory:folder});
 assert.equal(result.manifest.files,3);assert.equal(result.manifest.bytes,6);assert.equal(result.manifest.partial,false);
 assert.deepEqual(result.manifest.directories,['データ']);
 assert.equal(await fs.readFile(path.join(result.folder,'files/manifest.json'),'utf8'),'abc');
 assert.equal((await fs.stat(path.join(result.folder,'files/データ/empty'))).size,0);
 for(const entry of result.manifest.entries)assert.equal(await saves.hashFile(path.join(result.folder,'files',entry.path)),entry.sha256);
 assert.deepEqual([...f.attachment.s.handles],[1]);
 const open=f.calls.find(c=>c.cmd===53);assert.equal(open.input.subarray(16,32).toString('hex'),uid);assert.equal(open.input.readUInt16LE(42),2);
 assert.ok(f.calls.every(c=>[0,53,61].includes(c.cmd)));
});
test('failed or cancelled save copy never leaves a downloadable partial backup',async t=>{
 for(const options of [{short:true},{rows:[{name:'../escape',type:1,size:'3'}]},{rows:[{name:'slot',type:9,size:'3'}]}]){
  const folder=await directory(t),f=attached(options);
  await assert.rejects(saves.snapshot({...f,archive,directory:folder}));
  assert.deepEqual(await fs.readdir(folder),[]);assert.deepEqual([...f.attachment.s.handles],[1]);
 }
 const folder=await directory(t),f=attached();let stopped=false;
 await assert.rejects(saves.snapshot({...f,archive,directory:folder,shouldStop:()=>stopped,onProgress:()=>{stopped=true;}}),{code:'FTP_CANCELLED'});
 assert.deepEqual(await fs.readdir(folder),[]);assert.deepEqual([...f.attachment.s.handles],[1]);
});
test('stale and system archives are never opened as a fallback',async t=>{
 const folder=await directory(t),f=attached({count:0});
 await assert.rejects(saves.snapshot({...f,archive,directory:folder}),/no longer/);
 await assert.rejects(saves.snapshot({...f,archive:{...archive,type:0},directory:folder}),/Unsupported/);
 assert.ok(f.calls.every(c=>c.cmd!==53));
});
test('a failed save filesystem close cannot leave a successful backup behind',async t=>{
 const folder=await directory(t),f=attached(),ipc=f.attachment.s.ipc,close=f.attachment.s.close;let ownedSave;
 f.attachment.s.ipc=async(...args)=>{const reply=await ipc(...args);if(args[2]===53)ownedSave=reply.moves[0];return reply;};
 f.attachment.s.close=async h=>{if(h===ownedSave)throw Error('save close failed');return close(h);};
 await assert.rejects(saves.snapshot({...f,archive,directory:folder}),e=>e.cleanupBlocked===true&&/save close failed/.test(e.message));
 assert.deepEqual(await fs.readdir(folder),[]);assert.ok(f.attachment.s.handles.has(ownedSave));
});
test('download host uses a Mac interface on the console subnet',()=>{
 assert.equal(server.hostAddress('192.168.1.8',{en0:[{family:'IPv4',address:'192.168.1.2',netmask:'255.255.255.0',internal:false}]}),'192.168.1.2');
 assert.throws(()=>server.hostAddress('10.0.0.2',{}),/No Mac IPv4/);
});
function request(url,{method='GET',headers={},suffix=''}={}){return new Promise((resolve,reject)=>{
 const u=new URL(url),req=http.request({hostname:u.hostname,port:u.port,path:u.pathname+suffix,method,headers},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end();});}
test('read-only HTTP/WebDAV serves the verified snapshot, ranges and Unicode; rejects writes and traversal',async t=>{
 const folder=await directory(t),f=attached(),backup=await saves.snapshot({...f,archive,directory:folder});
 const name='Game [id]',download=await server.start({...backup,name,address:'127.0.0.1',port:0});t.after(()=>download.close());
 assert.equal((await request(download.url)).status,200);
 const uri=encodeURIComponent(name)+'/files/'+encodeURIComponent('データ')+'/slot.bin';
 const data=await request(download.url,{suffix:uri});assert.equal(data.body,'abc');
 assert.equal((await request(download.url,{method:'HEAD',suffix:uri})).headers['content-length'],'3');
 assert.equal((await request(download.url,{suffix:uri,headers:{Range:'bytes=1-2'}})).body,'bc');
 assert.equal((await request(download.url,{suffix:uri,headers:{Range:'bytes=9-'}})).status,416);
 const dav=await request(download.url,{method:'PROPFIND',headers:{Depth:'infinity'}});assert.equal(dav.status,207);assert.match(dav.body,/manifest.json/);assert.match(dav.body,/%E3%83/);
 assert.equal((await request(download.url,{method:'PUT',suffix:uri})).status,405);
 assert.equal((await request(download.url,{suffix:'%2e%2e/manifest.json'})).status,400);
 assert.equal((await request(download.url,{suffix:'%2Fetc/passwd'})).status,400);
 assert.equal(new URL(download.url).pathname,'/');
 assert.equal((await request(download.url,{suffix:encodeURIComponent(name)+'/files/manifest.json'})).body,'abc');
 assert.equal(JSON.parse((await request(download.url,{suffix:encodeURIComponent(name)+'/manifest.json'})).body).files,3);
 const proof=await download.close();assert.deepEqual(proof,{localStopped:true,connectionsClosed:true});
 assert.equal((await fs.stat(backup.folder)).isDirectory(),true);
});
test('consecutive exports reuse port 8081 and the root URL; an occupied port is reported',async t=>{
 const folder=await directory(t),f=attached(),backup=await saves.snapshot({...f,archive,directory:folder});
 const options={...backup,name:'Game [id]',address:'127.0.0.1'};
 const first=await server.start(options);t.after(()=>first.close());
 assert.equal(first.url,'http://127.0.0.1:8081/');
 await assert.rejects(server.start(options),e=>e.code==='SAVE_PORT_IN_USE'&&/8081/.test(e.message));
 assert.equal((await request(first.url)).status,200);
 await first.close();
 const second=await server.start(options);t.after(()=>second.close());
 assert.equal(second.url,first.url);
 assert.equal((await request(second.url,{method:'PROPFIND',headers:{Depth:'1'}})).status,207);
 await second.close();
});
test('download startup refuses corrupted or missing snapshot files',async t=>{
 const folder=await directory(t),f=attached(),backup=await saves.snapshot({...f,archive,directory:folder});
 await fs.writeFile(path.join(backup.folder,'files/データ/slot.bin'),'bad');
 await assert.rejects(server.start({...backup,name:'Game',address:'127.0.0.1'}),/changed/);
});
test('save button request dispatch is separate from normal, raw and Back requests',async()=>{
 const events=[],rpc={async write(){events.push('clear');}},service={select:i=>events.push(['select',i]),selectRaw:i=>events.push(['raw',i]),back:()=>events.push('back')};
 for(const req of [1,0x80000002,0xc0000003,0xffffffff])await dispatchServiceRequest(rpc,100,service,req);
 assert.deepEqual(events,['clear',['select',0],'clear',['raw',1],'clear',['raw',0x40000002],'clear','back']);
});
