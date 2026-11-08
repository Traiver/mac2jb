'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const saves=require('../integrations/mintbrew-ouncecake/saves.cjs');
const files=require('../integrations/mintbrew-ouncecake/save-import-files.cjs');
const importer=require('../integrations/mintbrew-ouncecake/save-import.cjs');
const archive={id:'123',space:1,type:1,rank:0,index:0,uid:'00112233445566778899aabbccddeeff',titleId:'0400123456780000',size:'8192'};
async function temp(t){const p=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'ouncecake-import-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
function attached(options={}){
 const calls=[],memory=new Map(),handles=new Map([[1,{kind:'root'}]]);let next=2,recordSpace=1;
 let disk=new Map([['slot.bin',Buffer.from('old')],['nested/keep.bin',Buffer.from('keep')]]),dirs=new Set(['nested','empty']);
 const clone=m=>new Map([...m].map(([p,b])=>[p,Buffer.from(b)]));
 const s={base:0x100000,bytes:0x80000,threads:new Set(),handles:new Set([1]),
  async write(address,bytes){memory.set(address,Buffer.from(bytes));},
  async read(){const b=Buffer.alloc(0x60);b.writeBigUInt64LE(BigInt(archive.id));b[8]=1;b[9]=1;Buffer.from(archive.uid,'hex').copy(b,16);b.writeBigUInt64LE(BigInt('0x'+archive.titleId),40);b.writeBigUInt64LE(8192n,48);return b;},
  async close(h){calls.push(['close',h]);if(options.closeFailure&&handles.get(h)?.writable)throw Error('writable close failed');s.handles.delete(h);handles.delete(h);},
  async ipc(label,h,command,input,extra){
   calls.push([label,command]);
   if(command===61){recordSpace=input[0];return moved({kind:'reader'});}
   if(command===51||command===53){
    if(command===51&&options.openFailure)throw Error('transport timed out');
    if(command===53&&options.beforeRead)options.beforeRead({disk,calls});
    const a=moved({kind:'save',writable:command===51,files:clone(disk),dirs:new Set(dirs)});
    if(command===51){assert.equal(input[40],archive.type);assert.equal(input.subarray(16,32).toString('hex'),archive.uid);}
    return a;
   }
   const handle=handles.get(h);assert.ok(handle);
   if(handle.kind==='reader'){assert.equal(command,0);const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt(recordSpace===1?1:0));return {result:0,data};}
   if(handle.kind==='save'){assert.equal(command,10);assert.ok(handle.writable);if(options.commitFailure)throw Error('commit connection lost');disk=clone(handle.files);dirs=new Set(handle.dirs);if(options.corrupt)disk.set('slot.bin',Buffer.from('bad'));return {result:0};}
   const save=handles.get(handle.save);assert.ok(save.writable);
   if(command===3)save.files.set(handle.path,Buffer.alloc(Number(input.readBigUInt64LE())));
   else if(command===1){if(options.writeFailure)throw Error('write failed');const offset=Number(input.readBigUInt64LE(8));memory.get(extra.send[0].address).copy(save.files.get(handle.path),offset);}
   else assert.equal(command,2);
   return {result:0};
  }};
 function moved(value){const h=next++;handles.set(h,value);s.handles.add(h);return {result:0,moves:[h],copies:[]};}
 const domain={oneHandle:r=>r.moves[0],async send(s,label,h,packet){
  const save=handles.get(h),name=memory.get(s.base+0x2000).toString().split('\0')[0].slice(1),cmd=packet.readUInt32LE(24);
  assert.ok(save.writable);calls.push([label,cmd]);
  if(cmd===2){assert.ok(!save.dirs.has(name));save.dirs.add(name);}else{assert.equal(cmd,0);assert.ok(!save.files.has(name));save.files.set(name,Buffer.alloc(Number(packet.readBigUInt64LE(40))));}
  return {result:0};
 }};
 const filesystem={
  async listDirectory(s,h,remote){const save=handles.get(h),prefix=remote==='/'?'':remote.slice(1)+'/';return [
   ...[...save.dirs].filter(p=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(p=>({name:p.slice(prefix.length),type:0})),
   ...[...save.files].filter(([p])=>p.startsWith(prefix)&&!p.slice(prefix.length).includes('/')).map(([p,b])=>({name:p.slice(prefix.length),type:1,size:String(b.length)}))];},
  async openFile(s,h,name){return this.pathMethod(s,h,8,name,Buffer.from([1,0,0,0]));},
  async pathMethod(s,h,cmd,name,flags){const save=handles.get(h),p=name.slice(1);assert.equal(cmd,8);if(!save.files.has(p))return {result:0x202,canonicalResult:0x202};if(flags.readUInt32LE()===3)assert.ok(save.writable);const r=moved({kind:'file',save:h,path:p});return {...r,handle:r.moves[0]};},
  async fileSize(s,h){const f=handles.get(h);return BigInt(handles.get(f.save).files.get(f.path).length);},
  async readFile(s,h,offset,amount){const f=handles.get(h);return Buffer.from(handles.get(f.save).files.get(f.path).subarray(offset,offset+amount));}
 };
 return {attachment:{s,root:1,domain,filesystem,live:{session:'session'}},calls,get disk(){return disk;}};
}
async function prepared(t,options={}){
 const directory=await temp(t),f=attached(options);
 const exported=await saves.snapshot({...f,archive,directory:path.join(directory,'exports')});
 const exportBackup=options.web?path.join(directory,'verified-export'):undefined;
 if(exportBackup)await fs.cp(exported.folder,exportBackup,{recursive:true});
 await fs.writeFile(path.join(exported.folder,'files/slot.bin'),'new edited save');
 await fs.rm(path.join(exported.folder,'files/nested/keep.bin'));
 await fs.writeFile(path.join(exported.folder,'files/zero.bin'),Buffer.alloc(0));
 await fs.mkdir(path.join(exported.folder,'files/new-dir'));await fs.writeFile(path.join(exported.folder,'files/new-dir/extra'),'new');
 const request=await files.create({directory:path.join(directory,'requests'),archive,titleName:'Game',sourceSession:'session',
  transport:options.web?'webdav':undefined});
 const plan=await files.stage({folder:request.folder,source:exported.folder});
 return {...f,get disk(){return f.disk;},directory,request,plan,exported,exportBackup};
}
async function restore(f,extra={}){return importer.restore({...f,archive,folder:f.request.folder,digest:f.plan.digest,confirmed:true,directory:path.join(f.directory,'backup'),...extra});}
test('edited source is staged with current hashes; files omitted locally are preserved, new/nested/empty files work',async t=>{
 const f=await prepared(t);await fs.writeFile(path.join(f.exported.folder,'files/slot.bin'),'later source edit');
 const states=[];const result=await restore(f,{onState:async s=>states.push(s)});
 assert.equal(result.verified,true);assert.equal(result.files,3);assert.deepEqual(states.map(s=>s.phase),['backup','checking','writing','verifying','complete']);
 assert.equal(f.disk.get('slot.bin').toString(),'new edited save');assert.equal(f.disk.get('nested/keep.bin').toString(),'keep');assert.equal(f.disk.get('new-dir/extra').toString(),'new');
 assert.equal(await fs.readFile(path.join(result.backupPath,'files/slot.bin'),'utf8'),'old');
 assert.ok(f.calls.some(c=>c[0]==='Create save directory /new-dir'&&c[1]===2));
 assert.equal(f.calls.filter(c=>c[1]===51).length,1);assert.equal(f.calls.filter(c=>c[0]==='Commit save data filesystem').length,1);
 assert.deepEqual([...f.attachment.s.handles],[1]);
});
test('explicit confirmation and exact target identity are required before a writable mount',async t=>{
 const f=await prepared(t);await assert.rejects(restore(f,{confirmed:false}),/Confirm/);
 await assert.rejects(restore(f,{archive:{...archive,uid:'f'.repeat(32)}}),/target changed/);
 assert.ok(!f.calls.some(c=>c[1]===51));
});
test('staged tampering and expired requests fail before backup or writes',async t=>{
 const f=await prepared(t),plan=await files.planAt(f.request.folder,f.plan.digest);
 await fs.chmod(path.join(plan.stageRoot,'slot.bin'),0o600);await fs.writeFile(path.join(plan.stageRoot,'slot.bin'),'tampered');
 await assert.rejects(restore(f),/Staged file changed/);assert.ok(!f.calls.some(c=>c[1]===51));
 const r=await files.json(path.join(f.request.folder,'request.json'));r.expires=Date.now()-1;await files.atomic(path.join(f.request.folder,'request.json'),r);
 await assert.rejects(files.command(f.request.folder,'confirm',f.plan.digest),/expired/);
});
test('source UID mismatch, partial collections, traversal, and symbolic links are rejected',async t=>{
 const f=await prepared(t),manifest=f.exported.manifest;
 for(const change of [{selection:{...archive,uid:'f'.repeat(32)}},{partial:true},{format:'mac2jb.save-collection'},{entries:[{path:'../escape',size:1,sha256:'a'.repeat(64)}],files:1}]){
  await files.atomic(path.join(f.exported.folder,'manifest.json'),{...manifest,...change});
  await assert.rejects(files.stage({folder:f.request.folder,source:f.exported.folder}));
 }
 await files.atomic(path.join(f.exported.folder,'manifest.json'),manifest);
 await fs.symlink('/etc/hosts',path.join(f.exported.folder,'files/link'));
 await assert.rejects(files.stage({folder:f.request.folder,source:f.exported.folder}),/regular files/);
 assert.ok(!f.calls.some(c=>c[1]===51));
});
test('BCAT, secondary and nonzero-index imports are refused while exports remain unaffected',()=>{
 for(const change of [{type:2},{rank:1},{index:1}])assert.throws(()=>files.supported({...archive,...change}),/supports primary/);
 assert.equal(files.supported({...archive,type:3,uid:'0'.repeat(32)}).type,3);
});
test('a changing live save aborts before writable open and retains the verified original backup',async t=>{
 const f=await prepared(t);let reads=0;
 const saveTools={...saves,async snapshot(options){const result=await saves.snapshot(options);if(++reads===1)f.disk.set('slot.bin',Buffer.from('changed while backing up'));return result;}};
 await assert.rejects(restore(f,{saveTools}),/live save changed/);assert.ok(!f.calls.some(c=>c[1]===51));
 assert.equal((await fs.readdir(path.join(f.directory,'backup/before-import'))).length,1);
});
test('WebDAV keeps the existing backup and checks the live save once before writing',async t=>{
 const f=await prepared(t,{web:true}),start=f.calls.length;
 const result=await restore(f);
 assert.equal(result.backupPath,f.exportBackup);
 assert.equal(await fs.readFile(path.join(result.backupPath,'files/slot.bin'),'utf8'),'old');
 assert.deepEqual(await fs.readdir(path.join(f.directory,'backup')),['after-import']);
 const operations=f.calls.slice(start).map(([,command])=>command).filter(command=>command===53||command===51);
 assert.deepEqual(operations,[53,51,53]);
 assert.equal(f.disk.get('nested/keep.bin').toString(),'keep');
});
test('WebDAV rejects a stale or damaged export backup before opening the save writable',async t=>{
 const stale=await prepared(t,{web:true});
 stale.disk.set('nested/keep.bin',Buffer.from('changed since export'));
 await assert.rejects(restore(stale),/reopen the save export/);
 assert.ok(!stale.calls.some(c=>c[1]===51));
 const damaged=await prepared(t,{web:true});
 await fs.writeFile(path.join(damaged.exportBackup,'files/slot.bin'),'bad');
 await assert.rejects(restore(damaged),/backup failed verification/);
 assert.ok(!damaged.calls.some(c=>c[1]===51));
});
test('backup errors and cancellation never open writable storage',async t=>{
 const f=await prepared(t);
 await assert.rejects(restore(f,{saveTools:{...saves,async snapshot(){throw Error('backup disk full');}}}),/disk full/);
 await assert.rejects(restore(f,{shouldStop:()=>true}),{code:'FTP_CANCELLED'});assert.ok(!f.calls.some(c=>c[1]===51));
});
test('write/commit/close/readback failure stays unsafe, keeps the backup, and never retries',async t=>{
 for(const option of ['writeFailure','commitFailure','closeFailure','corrupt']){
  const f=await prepared(t,{[option]:true});const states=[];
  await assert.rejects(restore(f,{onState:async s=>states.push(s)}),e=>e.cleanupBlocked===true);
  assert.equal(f.calls.filter(c=>c[1]===51).length,1);assert.equal(states.at(-1).phase,'failed');assert.equal(states.at(-1).writeMayHaveOccurred,true);
  assert.ok(await fs.stat(states.at(-1).backupPath));assert.ok(!states.some(s=>s.phase==='complete'));
 }
});
test('confirmation files are nonce-bound and one-shot; cancel never prepares a write',async t=>{
 const f=await prepared(t);await files.command(f.request.folder,'confirm',f.plan.digest);
 const command=await files.json(path.join(f.request.folder,'command.json'));assert.equal(command.nonce,f.request.request.nonce);
 await assert.rejects(files.command(f.request.folder,'confirm',f.plan.digest),{code:'EEXIST'});
 const other=await files.create({directory:path.join(f.directory,'requests'),archive,titleName:'Game',sourceSession:'session'});
 await files.command(other.folder,'cancel');assert.equal((await files.json(path.join(other.folder,'command.json'))).action,'cancel');
});

test('an ambiguous writable-open failure blocks the session without retrying',async t=>{
 const f=await prepared(t,{openFailure:true}),states=[];
 await assert.rejects(restore(f,{onState:async state=>states.push(state)}),e=>e.cleanupBlocked===true&&/transport/.test(e.message));
 assert.equal(f.calls.filter(c=>c[1]===51).length,1);assert.equal(states.at(-1).cleanupBlocked,true);assert.ok(states.at(-1).backupPath);
});
test('cancellation after the first write is deferred until commit and verified readback',async t=>{
 const f=await prepared(t);const result=await restore(f,{shouldStop:()=>f.calls.some(c=>c[0]==='Write save file')});
 assert.equal(result.verified,true);assert.deepEqual([...f.attachment.s.handles],[1]);
});

test('multi-chunk imports stay within the owned transfer buffer and verify the last short chunk',async t=>{
 const f=await prepared(t),source=path.join(f.exported.folder,'files/slot.bin');
 await fs.writeFile(source,Buffer.alloc(0x90007,0xa5));
 const plan=await files.stage({folder:f.request.folder,source:f.exported.folder});f.plan=plan;
 const result=await restore(f);assert.equal(result.verified,true);assert.equal(f.disk.get('slot.bin').length,0x90007);
 assert.equal(f.disk.get('slot.bin').at(-1),0xa5);assert.ok(f.calls.filter(c=>c[0]==='Write save file').length>=4);
});
test('changing staged bytes during the automatic backup aborts before a writable mount',async t=>{
 const f=await prepared(t);let backups=0;
 const saveTools={...saves,async snapshot(options){const result=await saves.snapshot(options);if(++backups===1){
  const plan=await files.planAt(f.request.folder,f.plan.digest),file=path.join(plan.stageRoot,'slot.bin');await fs.chmod(file,0o600);await fs.writeFile(file,'tampered after confirmation');
 }return result;}};
 await assert.rejects(restore(f,{saveTools}),/Staged file changed/);assert.ok(!f.calls.some(c=>c[1]===51));
});

test('Finder and Explorer metadata is skipped unless the original game save owned that filename',async t=>{
 const f=await prepared(t);
 for(const name of ['.DS_Store','._slot.bin','Thumbs.db','desktop.ini'])await fs.writeFile(path.join(f.exported.folder,'files',name),'local metadata');
 await fs.mkdir(path.join(f.exported.folder,'files/__MACOSX'));await fs.writeFile(path.join(f.exported.folder,'files/__MACOSX/extra'),'metadata');
 let plan=await files.stage({folder:f.request.folder,source:f.exported.folder});let sealed=await files.planAt(f.request.folder,plan.digest);
 assert.equal(sealed.files,3);assert.ok(!sealed.entries.some(e=>e.path.includes('.DS_Store')));
 const manifest=await files.json(path.join(f.exported.folder,'manifest.json'));manifest.entries.push({path:'Thumbs.db',size:14,sha256:'a'.repeat(64)});manifest.files++;
 await files.atomic(path.join(f.exported.folder,'manifest.json'),manifest);plan=await files.stage({folder:f.request.folder,source:f.exported.folder});sealed=await files.planAt(f.request.folder,plan.digest);
 assert.equal(sealed.files,4);assert.ok(sealed.entries.some(e=>e.path==='Thumbs.db'));
});

test('an import request from a different held console session never opens writable storage',async t=>{
 const f=await prepared(t);f.attachment.live.session='different-session';
 await assert.rejects(restore(f),/another held console session/);assert.ok(!f.calls.some(c=>c[1]===51));
});
