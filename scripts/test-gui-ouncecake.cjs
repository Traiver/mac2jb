'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{PassThrough}=require('node:stream');
const {spawnSync}=require('node:child_process');
const {main,verifySnapshot,validateConfiguration,catalogEntries,validateAttachment}=require('./gui-ouncecake.cjs');
const {deployServer}=require('../vendor/OunceCake/engine/server.cjs');
const {withProgramIndexMap}=require('../vendor/OunceCake/engine/fs-context.cjs');
const root=path.resolve(__dirname,'..'),title='0100000000001234';
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function until(check){for(let n=0;n<200;n++){if(check())return;await wait(5);}throw Error('Fixture timed out');}
async function folder(t){const value=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'ouncecake-fixture-'));t.after(()=>fs.rm(value,{recursive:true,force:true}));return value;}
test('real self-test verifies the complete pin and image without a run or native connection',async()=>{
 const result=spawnSync(process.execPath,[path.join(root,'scripts/gui-ouncecake.cjs'),'--self-test'],{encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).files,33);
 assert.equal(JSON.parse(result.stdout).commit,'6dfd7750752f8b6c18f2c40b34fdadc628cd9a6e');
});
test('changed bundled code is refused before loading any console interface',async t=>{
 const target=await folder(t);await fs.mkdir(path.join(target,'vendor'));await fs.mkdir(path.join(target,'packaging'));
 await fs.cp(path.join(root,'vendor/OunceCake'),path.join(target,'vendor/OunceCake'),{recursive:true});
 for(const file of ['OunceCake-SHA256SUMS','OunceCake-upstream-SHA256SUMS','OunceCake-provenance.json'])await fs.copyFile(path.join(root,'packaging',file),path.join(target,'packaging',file));
 await fs.appendFile(path.join(target,'vendor/OunceCake/engine/session.cjs'),'\n// changed');
 await assert.rejects(verifySnapshot(target),/Changed bundled OunceCake file/);
});
test('configuration and catalog are explicit, bounded and omit arbitrary fields',()=>{
 assert.deepEqual(validateConfiguration({consoleAddress:'192.0.2.20',port:8080}),{consoleAddress:'192.0.2.20',port:8080});
 for(const value of [{port:8080},{consoleAddress:'host.local',port:8080},{consoleAddress:'192.0.2.1',port:21},null,[]])assert.throws(()=>validateConfiguration(value));
 const catalog=catalogEntries([{title,name:'💛'.repeat(100)+'\nSECRET',storages:[4,4,2],token:'secret'}]);
 assert.ok(Buffer.byteLength(catalog[0].name)<=160);assert.deepEqual(catalog[0].storages,[4,2]);assert.equal(catalog[0].token,undefined);
 assert.throws(()=>catalogEntries([]));assert.throws(()=>catalogEntries(Array(1001).fill({title,name:'Title',storages:[4]})));
 assert.throws(()=>catalogEntries([{title,name:'Title',storages:[3]}]));
});
async function proofFixture(t){
 const directory=await folder(t),session='owned-session',reportFile=path.join(directory,'report.json'),engine=path.join(directory,'switch2');
 const proofFile=path.join(engine,'ro/root/proof.json'),socket=path.join(directory,'memory.sock');
 const rows={
  [reportFile]:{memoryControl:{socketPath:socket}},
  [path.join(engine,'current-acquisition.json')]:{session,report:reportFile,socketPath:socket},
  [path.join(engine,'ro/root/current-root.json')]:{session,report:reportFile,proof:proofFile,pid:1,rootHandle:9,rootAddress:2**33},
  [proofFile]:{session,report:reportFile,success:true,cloneIdentityVerified:true,rootHandle:9,rootAddress:2**33},
  [path.join(engine,'ro',session+'-layout.json')]:{session,report:reportFile,count:0x4000,table:2**34,rootVptr:2**35}
 };
 for(const [file,value]of Object.entries(rows)){await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,JSON.stringify(value),{mode:0o600});}
 return {run:{directory,proof:{session,reportFile}},rows,write:async(file,value)=>fs.writeFile(file,JSON.stringify(value),{mode:0o600})};
}
test('additional promoted-root proofs reject stale sessions, mismatched sockets and symlinks',async t=>{
 const f=await proofFixture(t);await validateAttachment(f.run);
 const file=path.join(f.run.directory,'switch2/ro/root/current-root.json'),value=f.rows[file];
 await f.write(file,{...value,session:'another-boot'});await assert.rejects(validateAttachment(f.run),/verified promoted FS root/);
 await f.write(file,value);
 const acquisition=path.join(f.run.directory,'switch2/current-acquisition.json');await f.write(acquisition,{...f.rows[acquisition],socketPath:'/other/socket'});
 await assert.rejects(validateAttachment(f.run),/verified promoted FS root/);await f.write(acquisition,f.rows[acquisition]);
 const proof=value.proof,other=proof+'.other';await fs.rename(proof,other);await fs.symlink(other,proof);await assert.rejects(validateAttachment(f.run),/private owned/);
});
async function helperFixture(t,options={}){
 const directory=await folder(t),held=path.join(directory,'held');await fs.mkdir(held,{mode:0o700});
 if(options.existingAttempt)await fs.writeFile(path.join(held,'.mac2jb-hblauncher-attempt.json'),'{}',{mode:0o600});
 const input=new PassThrough(),events=[],calls=[],blockedGate=deferred();let live=true,finished=false;
 const attachment={live:{session:'held-session'},s:{base:4096,handles:new Set([7]),threads:new Set()},
  async close(){calls.push('attachment-close');this.s.base=0;this.s.handles.clear();}};
 const modules={session:{async attachGame(){calls.push('attach');if(options.attachFailure)throw Error('attachment ownership uncertain');return attachment;}},
  content:{async discoverGames(){calls.push('catalog');return [{title,name:'Fixture Game',storages:[4]}];}},
  mounts:{async prepareGame(args){calls.push('prepare:'+args.title);if(options.prepareFailure)throw Error('mount failed');return {index:Buffer.alloc(64),sources:[{handle:7}]};}},
  server:{async deployServer(args){calls.push('deploy:'+args.port);return {async close(){calls.push('ftp-close');if(options.stopFailure)throw Object.assign(Error('thread still active'),{cleanupBlocked:true});return {nativeStopped:true,joined:true,mappingsCleared:true};}};}}};
 if(options.exportsEngine)modules.exports=options.exportsEngine;
 const promise=main([held],{root:directory,input,modules,isLive:()=>live,waitBlocked:()=>blockedGate.promise,
  verifySnapshot:async()=>({vendor:'unused',image:Buffer.alloc(16)}),validateRun:async()=>({directory:held,proof:{session:'held-session'}}),validateAttachment:async()=>{},
  emit:(type,fields)=>{events.push({type,...fields});options.onEvent?.({type,...fields},input);}
 }).finally(()=>{finished=true;});promise.catch(()=>{});
 input.write(JSON.stringify({consoleAddress:'192.0.2.88',port:8080})+'\n');
 t.after(async()=>{live=false;input.end();blockedGate.resolve();await promise.catch(()=>{});});
 return {input,events,calls,attachment,promise,blockedGate,get finished(){return finished;}};
}
test('one selected catalog title uses the exact configured console endpoint and stops HTTP/WebDAV before attachment',async t=>{
 const f=await helperFixture(t,{onEvent(event,input){if(event.type==='catalog')input.write(JSON.stringify({action:'select-game',titleId:title})+'\n'+JSON.stringify({action:'select-game',titleId:title})+'\n');if(event.type==='running')input.end();}});
 await f.promise;assert.equal(f.calls.filter(call=>call.startsWith('prepare:')).length,1);assert.equal(f.calls.filter(call=>call.startsWith('deploy:')).length,1);
 const running=f.events.find(event=>event.type==='running');assert.equal(running.host,'192.0.2.88');assert.equal(running.httpURL,'http://192.0.2.88:8080/');
 assert.ok(f.calls.indexOf('ftp-close')<f.calls.indexOf('attachment-close'));assert.equal(f.events.at(-1).type,'stopped');
});
test('EOF before selection releases only the attachment and never deploys native HTTP/WebDAV',async t=>{
 const f=await helperFixture(t,{onEvent(event,input){if(event.type==='catalog')input.end();}});await f.promise;
 assert.deepEqual(f.calls,['attach','catalog','attachment-close']);
});
test('an existing launcher or Stremio attempt prevents another native attachment',async t=>{
 const f=await helperFixture(t,{existingAttempt:true});await assert.rejects(f.promise,/EEXIST/);assert.deepEqual(f.calls,[]);
 assert.equal(f.events.find(event=>event.type==='failed').cleanupBlocked,false);
});
for(const failure of ['attachFailure','prepareFailure','stopFailure'])test(failure+' retains held resources and remains alive until the restart boundary',async t=>{
 const f=await helperFixture(t,{[failure]:true,onEvent(event,input){if(event.type==='catalog')input.write(JSON.stringify({action:'select-game',titleId:title})+'\n');if(event.type==='running')input.end();}});
 await until(()=>f.events.some(event=>event.type==='failed'));const event=f.events.find(event=>event.type==='failed');assert.equal(event.cleanupBlocked,true);
 assert.equal(f.calls.includes('attachment-close'),false);assert.equal(f.finished,false);f.input.end();await wait(10);assert.equal(f.finished,false);
 f.blockedGate.resolve();await assert.rejects(f.promise,error=>error.cleanupBlocked===true);
 assert.equal(f.calls.includes('attachment-close'),false);
});

function nativeFixture(scenario={}){
 const sdk=2**32,base=2**33,thread=2**34,destination=2**35,trace=[];let clock=0,stop=false;
 const names=['_ZN2nn6socket6SocketEiii','_ZN2nn6socket4BindEiPKNS0_8SockAddrEj','_ZN2nn6socket6ListenEii',
  '_ZN2nn6socket6AcceptEiPNS0_8SockAddrEPj','_ZN2nn6socket4RecvEiPvmi','_ZN2nn6socket4SendEiPKvmi',
  '_ZN2nn6socket5CloseEi','_ZN2nn6socket4PollEPNS0_6PollFdEmi','_ZN2nn6socket11GetSockNameEiPNS0_8SockAddrEPj',
  '_ZN2nn6socket5FcntlEiiz','_ZN2nn6socket12GetLastErrnoEv','_ZN2nn6socket10SetSockOptEiiiPKvj','_ZN2nn6socket7ConnectEiPKNS0_8SockAddrEj'];
 const strings=Buffer.from('\0'+names.join('\0')+'\0'),symbols=Buffer.alloc(names.length*24);let stringAt=1;
 names.forEach((name,index)=>{const at=index*24;symbols.writeUInt32LE(stringAt,at);symbols[at+4]=2;symbols.writeUInt16LE(1,at+6);symbols.writeBigUInt64LE(BigInt(0x4000+index*64),at+8);symbols.writeBigUInt64LE(32n,at+16);stringAt+=Buffer.byteLength(name)+1;});
 class Session{
  constructor(label,bytes){this.base=0;this.handles=new Set();this.threads=new Set();trace.push('allocate:'+bytes);}
  async initialize(){trace.push('initialize');if(scenario.nullAllocation){this.base=0;throw Error('Invalid allocation');}if(scenario.invalidAllocation){this.base=3;throw Error('Invalid allocation');}this.base=base;}
  async verifyCode(expected,label){trace.push('verify:'+label);if(scenario.signatureFailure)throw Error('instructions differ');}
  async read(address,size){
   const output=Buffer.alloc(size);
   if(address===sdk){output.writeInt32LE(0x100,4);return output;}
   if(address===sdk+0x100){output.write('MOD0');output.writeInt32LE(0x100,4);return output;}
   if(address===sdk+0x200){[[4,0x1000],[5,0x2000],[6,0x3000],[10,strings.length],[11,24]].forEach(([tag,value],index)=>{output.writeBigInt64LE(BigInt(tag),index*16);output.writeBigUInt64LE(BigInt(value),index*16+8);});return output;}
   if(address===sdk+0x1000){output.writeUInt32LE(names.length,4);return output;}
   if(address===sdk+0x2000)return strings;
   if(address===sdk+0x3000)return symbols;
   throw Error('Unexpected native read');
  }
  async readOwned(address,size){const output=Buffer.alloc(size);if(address===base+0xa000){output.writeBigUInt64LE(BigInt(thread));return output;}
   if(address===base+0x4000){output.writeUInt32LE(stop?2:scenario.neverReady?0:1,16);return output;}throw Error('Unexpected owned read');}
  async write(address,bytes){if(address===base+0x5000){assert.equal(bytes.length,17*8);assert.equal(Number(bytes.readBigUInt64LE(15*8)),sdk+0x4000+11*64);assert.equal(Number(bytes.readBigUInt64LE(16*8)),sdk+0x4000+12*64);}if(address===base+0x4000){assert.equal(bytes.readUInt32LE(28),12);const cache=Number(bytes.readBigUInt64LE(112));assert.ok(cache>=4096&&cache<=0x40000);assert.ok(Number(bytes.readBigUInt64LE(240))>=4096+cache+16384);}if(address===base+0x400c){trace.push('stop');stop=true;}else trace.push('write');}
  async ipc(label,handle,command){if(command===0x524f0012){trace.push('map');if(scenario.mapFailure)throw Error('mapping uncertain');}
   if(command===0x524f0013)trace.push('unmap');const processReply=label==='HTTP/WebDAV verify application process';
   const data=Buffer.alloc(processReply&&scenario.shortProcessReply?32:104);data.writeBigUInt64LE(processReply&&scenario.zeroProcessId?0n:77n);
   if(data.length>=96)data.writeBigUInt64LE(BigInt(processReply&&scenario.badDestination?destination+1:destination),88);
   return {result:processReply&&scenario.processError?5:0,data};}
  async cleanup(){trace.push('free');if(!scenario.cleanupDeferred)this.base=0;}
  rpc={query:async address=>({result:0,permissions:5,attributes:0,address:sdk,size:0x5e1000}),
   call4:async()=>{trace.push('create');if(scenario.createFailure)throw Error('native create uncertain');return 0;},
   call3:async address=>{if(address===sdk+1217808){trace.push('tryWait');return scenario.stopTimeout?0:1;}trace.push('join');return scenario.joinFailure?5:0;}};
 }
 const attachment={Session,live:{sdk},s:{threads:new Set()},async service(){return 7;}};
 return {trace,attachment,options:{attachment,image:Buffer.alloc(16180),index:Buffer.alloc(64),sources:[{handle:7,kind:0,size:0}],port:8080,
  timing:{startupMs:100,stopMs:100,now:()=>clock,pause:async ms=>{clock+=ms;}}}};
}
test('native HTTP/WebDAV qualifies fixed helpers, confirms listening and joins before unmapping/freeing',async()=>{
 const f=nativeFixture(),server=await deployServer(f.options);assert.equal((await server.status()).state,1);
 assert.equal(f.trace.filter(item=>item.startsWith('verify:')).length,5);const result=await server.close();assert.equal(result.nativeStopped,true);
 assert.ok(f.trace.indexOf('join')<f.trace.indexOf('unmap'));assert.ok(f.trace.lastIndexOf('unmap')<f.trace.indexOf('free'));
 const count=f.trace.length;await server.close();assert.equal(f.trace.length,count,'cleanup cannot replay');
});
test('native signature mismatch refuses deployment before any executable mapping or thread',async()=>{
 const f=nativeFixture({signatureFailure:true});await assert.rejects(deployServer(f.options),/instructions differ/);
 assert.equal(f.trace.includes('create'),false);assert.equal(f.trace.includes('map'),false);assert.equal(f.trace.includes('free'),true);
});
test('native startup that never becomes listening fails and cleans up only after verified stop',async()=>{
 const f=nativeFixture({neverReady:true});await assert.rejects(deployServer(f.options),/did not confirm listening/);
 assert.ok(f.trace.indexOf('join')<f.trace.indexOf('unmap'));assert.equal(f.trace.includes('free'),true);
});
for(const scenario of ['stopTimeout','joinFailure','createFailure','mapFailure'])test('uncertain '+scenario+' never unmaps or frees native resources',async()=>{
 const f=nativeFixture({[scenario]:true});let task;
 if(scenario==='stopTimeout'||scenario==='joinFailure'){const server=await deployServer(f.options);task=server.close();}else task=deployServer(f.options);
 await assert.rejects(task,error=>error.cleanupBlocked===true);assert.equal(f.trace.includes('unmap'),false);assert.equal(f.trace.includes('free'),false);
 if(scenario==='stopTimeout')assert.equal(f.trace.includes('join'),false);
});
test('deferred native allocation cleanup cannot claim successful shutdown',async()=>{
 const f=nativeFixture({cleanupDeferred:true}),server=await deployServer(f.options);
 await assert.rejects(server.close(),error=>error.cleanupBlocked===true&&/deferred/.test(error.message));
});
for(const scenario of ['shortProcessReply','zeroProcessId','badDestination','processError'])test(scenario+' rejects the process response before mapping code',async()=>{
 const f=nativeFixture({[scenario]:true});await assert.rejects(deployServer(f.options));
 assert.equal(f.trace.includes('map'),false);assert.equal(f.trace.includes('create'),false);
});
async function mapFixture(t,{cycle=false,small=false,badAddress=false}={}){
 const directory=await folder(t),engine=path.join(directory,'switch2');await fs.mkdir(path.join(engine,'ro'),{recursive:true});await fs.mkdir(path.join(engine,'tools'));
 await fs.writeFile(path.join(engine,'ro','map-session-layout.json'),'{}');const moduleFile=path.join(engine,'tools/fs-memory.cjs');await fs.writeFile(moduleFile,'module.exports={};');
 const rootAddress=2**32,nca=2**33,resolver=2**34,manager=2**35,head=manager+0x50,node=2**36,second=node+0x100;
 const pointers=new Map([[rootAddress+0x10,nca],[nca+0x18,resolver],[resolver+0x58,manager]]),reads=[];
 const memory={async pointer(address){assert.ok(pointers.has(address));return pointers.get(address);},async read(address,size){
  reads.push(address);const data=Buffer.alloc(size);
  if(address===head){data.writeBigUInt64LE(BigInt(badAddress?3:node),8);return data;}
  assert.ok(address===node||address===second);data.writeBigUInt64LE(BigInt(cycle?node:small&&address===node?second:head),8);
  data.writeBigUInt64LE(BigInt('0x'+title),0x10);data.writeBigUInt64LE(BigInt('0x'+title),0x18);return data;
 }};
 require.cache[moduleFile]={id:moduleFile,filename:moduleFile,loaded:true,exports:{connect:async()=>memory}};t.after(()=>delete require.cache[moduleFile]);
 const attachment={run:directory,live:{session:'map-session'},proof:{rootAddress},s:{bytes:small?0x10000+64:0x80000}};
 let operations=0;const run=()=>withProgramIndexMap({attachment,title,runtimeProgramId:title,operation:async()=>{operations++;return 'valid existing mapping';}});
 return {run,reads,get operations(){return operations;}};
}
test('program-map traversal accepts valid existing ownership without modifying it',async t=>{
 const f=await mapFixture(t);assert.equal(await f.run(),'valid existing mapping');assert.equal(f.operations,1);assert.equal(f.reads.length,2);
});
for(const scenario of ['cycle','small','badAddress'])test('program-map '+scenario+' is bounded before any operation or registration',async t=>{
 const f=await mapFixture(t,{[scenario]:true});await assert.rejects(f.run(),/invalid node, cycle or traversal bound/);
 assert.equal(f.operations,0);assert.ok(f.reads.length<=2);
});

test('standalone GUI helper routes firmware selection to the read-only system exporter',async t=>{
 let prepared=0;const exportsEngine={async discoverExports(){return [{title,name:'Firmware NCAs',storages:[3],kind:'firmware-nca'}];},
  async prepareExport(args){assert.equal(args.entry.kind,'firmware-nca');prepared++;return {index:Buffer.alloc(64),sources:[{handle:7}],exportInfo:{files:12}};}};
 const f=await helperFixture(t,{exportsEngine,onEvent(event,input){if(event.type==='catalog'){assert.equal(event.games[0].kind,'firmware-nca');input.write(JSON.stringify({action:'select-game',titleId:title})+'\n');}if(event.type==='running')input.end();}});
 await f.promise;assert.equal(prepared,1);assert.equal(f.events.at(-1).type,'stopped');
});

test('HTTP server keeps twelve slots within a small allocation for a small index',async()=>{
 const f=nativeFixture(),server=await deployServer(f.options);const requested=Number(f.trace.find(row=>row.startsWith('allocate:')).split(':')[1]);
 assert.ok(requested<5*1024*1024, 'small-index server must not require the old 52 MiB buffers');await server.close();
});
test('null server allocation reports request size and allows retry only after verified cleanup',async()=>{
 const f=nativeFixture({nullAllocation:true});await assert.rejects(deployServer(f.options),error=>error.code==='HTTP_SERVER_ALLOCATION_FAILED'&&error.retrySafe===true&&error.allocation.bytes<5*1024*1024&&error.allocation.indexBytes===64);
 assert.equal(f.trace.includes('create'),false);assert.equal(f.trace.includes('map'),false);
});
test('invalid nonzero allocation never frees an unverified pointer or permits retry',async()=>{
 const f=nativeFixture({invalidAllocation:true});await assert.rejects(deployServer(f.options),error=>error.cleanupBlocked===true&&error.allocation.invalidNonzeroAddress===true);
 assert.equal(f.trace.includes('free'),false);assert.equal(f.trace.includes('map'),false);
});
