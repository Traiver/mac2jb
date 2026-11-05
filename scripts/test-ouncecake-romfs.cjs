'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {readRomfs}=require('../vendor/OunceCake/engine/mounts.cjs');
const {canRawFallback}=require('../vendor/OunceCake/engine/preparation.cjs');
function emptyRomfs(){
 const b=Buffer.alloc(0x70);
 [0x50,0x50,4,0x54,24,0x6c,4,0x70,0,0x70].forEach((n,i)=>b.writeBigUInt64LE(BigInt(n),i*8));
 for(const off of [4,8,12,16])b.writeUInt32LE(0xffffffff,0x54+off);
 return b;
}
test('a valid empty RomFS still parses with exact metadata reads',async()=>{
 const b=emptyRomfs();assert.deepEqual(await readRomfs(async(o,n)=>b.subarray(o,o+n),b.length),[]);
});
test('an invalid header retains exact 64-bit size and a bounded diagnostic prefix',async()=>{
 const b=Buffer.alloc(0x50,0xff);
 await assert.rejects(readRomfs(async()=>b,4096),error=>{
  assert.equal(error.code,'ROMFS_HEADER_INVALID');assert.equal(error.message,'Invalid RomFS: header size');
  assert.deepEqual(error.romfsDiagnostic,{reason:'header-size',storageBytes:4096,expectedHeaderSize:'0x50',actualHeaderSize:'0xffffffffffffffff',headerPrefix:'ff'.repeat(16),zeroHeader:false});
  assert.equal(canRawFallback(error),false);return true;
 });
});
test('an all-zero header is diagnosed without accepting it as an empty filesystem',async()=>{
 await assert.rejects(readRomfs(async()=>Buffer.alloc(0x50),4096),error=>error.code==='ROMFS_HEADER_INVALID'&&error.romfsDiagnostic.zeroHeader&&error.romfsDiagnostic.actualHeaderSize==='0x0');
});
test('short header and directory reads are rejected before parsing incomplete metadata',async()=>{
 const b=emptyRomfs();
 for(const offset of [0,0x54])await assert.rejects(readRomfs(async(o,n)=>b.subarray(o,o+n-(o===offset?1:0)),b.length),error=>{
  assert.equal(error.code,'ROMFS_SHORT_READ');assert.equal(error.romfsDiagnostic.offset,offset);assert.equal(error.romfsDiagnostic.receivedBytes,error.romfsDiagnostic.expectedBytes-1);return true;
 });
});

const {readRomfsSection}=require('../vendor/OunceCake/engine/mounts.cjs');
const source={contentType:1,contentId:'a'.repeat(32),contentPath:'@UserContent://registered/program.nca',storage:4,programIndex:0};
const sectionOptions={storageSize:4096,source,title:'040094b02455c000',view:'/base/romfs'};
test('explicit partial Base closes invalid RomFS before the next section can open',async()=>{
 const order=[];let closeFinished=false;
 const result=await readRomfsSection({...sectionOptions,allowInvalid:true,
  read:async()=>{order.push('read');return Buffer.alloc(0x50);},
  close:async()=>{await new Promise(resolve=>setTimeout(resolve,5));closeFinished=true;order.push('close');}});
 assert.equal(closeFinished,true);assert.equal(result.entries,undefined);
 assert.equal(result.issue.status,'invalid');assert.equal(result.issue.path,'/base/romfs');
 assert.equal(result.issue.diagnostic.contentId,source.contentId);
 // A caller can now attempt CodeFS; no invalid RomFS view is presented as readable.
 order.push('open-exefs');assert.deepEqual(order,['read','close','open-exefs']);
});
test('absent-size RomFS remains an invalid partial section, never a valid empty filesystem',async()=>{
 const result=await readRomfsSection({...sectionOptions,storageSize:0,allowInvalid:true,
  read:async()=>assert.fail('must not read zero-sized storage'),close:async()=>{}});
 assert.equal(result.issue.status,'invalid');assert.equal(result.issue.diagnostic.reason,'storage size');
 assert.equal(result.entries,undefined);
});
test('failed storage close blocks continuation after an invalid header',async()=>{
 await assert.rejects(readRomfsSection({...sectionOptions,allowInvalid:true,read:async()=>Buffer.alloc(0x50),
  close:async()=>{throw Error('close unverified');}}),error=>error.cleanupBlocked===true&&error.message==='close unverified');
});
test('transport errors and cancellation never become partial-export success',async()=>{
 let closed=false;
 await assert.rejects(readRomfsSection({...sectionOptions,allowInvalid:true,
  read:async()=>{throw Error('RPC timed out');},close:async()=>{closed=true;}}),/RPC timed out/);
 assert.equal(closed,false);
 await assert.rejects(readRomfsSection({...sectionOptions,allowInvalid:true,shouldStop:()=>true,
  read:async()=>Buffer.alloc(0x50),close:async()=>{closed=true;}}),error=>error.code==='FTP_CANCELLED');
 assert.equal(closed,true);
});
test('normal whole-title exports keep strict RomFS validation',async()=>{
 let closed=false;
 await assert.rejects(readRomfsSection({...sectionOptions,read:async()=>Buffer.alloc(0x50),
  close:async()=>{closed=true;}}),error=>error.code==='ROMFS_HEADER_INVALID'&&error.romfsDiagnostic.view==='/base/romfs');
 assert.equal(closed,false);
});

function baseFixture({exefsAbsent=false,closeFails=false,compacted=false,codeResult=0,manualError}={}){
 const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
 const file=path.resolve(__dirname,'../vendor/OunceCake/engine/mounts.cjs');
 const loaded=new Module(file,module);loaded.filename=file;loaded.paths=module.paths;
 const order=[],handles=new Set(),metaKey=Buffer.alloc(16),contentId='ab'.repeat(16);
 const row={compacted,metadataAttributes:compacted?4:0,installType:0,storage:4,contentTitle:'0100000000000001',version:0,contents:[{contentType:1,programIndex:0}]};
 const source={...row,contentType:1,programIndex:0,contentId,metaKey,
  runtimeProgramId:row.contentTitle,contentPath:'@UserContent://registered/program.nca',attributes:0};
 if(manualError)row.contents.push({contentType:4,programIndex:0});
 const protocol=require('../vendor/OunceCake/engine/protocol.cjs');
 const content={discoverBase:async()=>[row],discoverUpdates:async()=>[],discoverDlc:async()=>[],discoverDataPatches:async()=>[],resolveContent:async({content})=>({...source,contentType:content.contentType})};
 loaded.require=name=>name==='./content.cjs'?content:name==='./program.cjs'?{
  createProgramMounts:()=>({openCode:async args=>{
   assert.equal(args.exactSource,!compacted);
   order.push('exefs');assert.ok(!handles.has(11),'RomFS storage must be closed first');
   if(exefsAbsent||codeResult)throw protocol.resultError('Open selected game CodeFS',codeResult||0x7d202);
   handles.add(12);return 12;
  }})
 }:module.require(Module._resolveFilename(name,loaded));
 loaded._compile(fs.readFileSync(file,'utf8'),file);
 let directoryReads=0;
 const value=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
 const a={s:{base:2**32,handles,threads:new Set(),async write(){},
  async close(h){order.push('close:'+h);if(h===11&&closeFails)throw Error('storage close unverified');handles.delete(h);},
  async ipc(label){
   if(label==='Game storage size')return {result:0,data:value(4096)};
   if(label==='Read game directory')return {result:0,data:value(directoryReads++?0:1)};
   if(label==='Server pin source database'){handles.add(21);return {result:0,handle:21};}
   if(label==='Server pin source version')return {result:0,data:metaKey};
   if(label==='Server pin source content')return {result:0,data:Buffer.from(contentId,'hex')};
   assert.fail('Unexpected IPC '+label);
  }},root:1,domain:{oneHandle:r=>r.handle,async send(s,label){
   if(label==='Open game logo')throw protocol.resultError(label,0x7d202);
   if(label==='Open game manual')throw manualError;
   assert.equal(label,'OpenDataStorageByPath');order.push('romfs');handles.add(11);return {result:0,handle:11};
  }},service:async()=>20,filesystem:{
   async readStorage(s,h,o,n){assert.equal(h,11);return manualError?emptyRomfs().subarray(o,o+n):Buffer.alloc(n);},
   async pathMethod(){handles.add(13);return {result:0,handle:13};},
   async verifiedBytes(){const b=Buffer.alloc(0x310);b.write('main');b[0x304]=1;b.writeBigUInt64LE(123n,0x308);return b;}
  }};
 return {a,order,handles,prepare:(options={part:'base'})=>loaded.exports.prepareGame({attachment:a,title:row.contentTitle,...options})};
}
test('real Base preparation exports ExeFS despite an invalid RomFS and reports both sections',async()=>{
 const f=baseFixture(),result=await f.prepare();
 assert.ok(f.order.indexOf('close:11')<f.order.indexOf('exefs'));
 assert.equal(result.exportInfo.partial,true);
 assert.ok(result.exportInfo.sections.some(s=>s.path==='/base/exefs'&&s.status==='available'&&s.entries===1));
 assert.ok(result.exportInfo.sections.some(s=>s.path==='/base/romfs'&&s.status==='invalid'));
 assert.equal(result.sources.length,1);assert.equal(result.sources[0].handle,12);
 assert.ok(result.index.includes(Buffer.from('main')));assert.equal(f.handles.has(11),false);
});
test('real Base preparation with no readable ExeFS reports absence instead of an empty success',async()=>{
 const f=baseFixture({exefsAbsent:true});
 await assert.rejects(f.prepare(),error=>{
  assert.equal(error.code,'EXPORT_PART_EMPTY');
  assert.ok(error.exportInfo.sections.some(s=>s.path==='/base/exefs'&&s.status==='absent'));
  assert.ok(error.exportInfo.sections.some(s=>s.path==='/base/romfs'&&s.status==='invalid'));return true;
 });
 assert.equal(f.handles.size,0);
});
test('real Base preparation never attempts ExeFS after an unverified RomFS close',async()=>{
 const f=baseFixture({closeFails:true});await assert.rejects(f.prepare(),error=>error.cleanupBlocked===true);
 assert.equal(f.order.includes('exefs'),false);assert.equal(f.handles.has(11),true);
});


test('automatic export recognizes compacted Base before attempting an invalid standalone mount',async()=>{
 const f=baseFixture({compacted:true});await assert.rejects(f.prepare({}),error=>{
  assert.equal(error.code,'COMPACTED_BASE');assert.equal(error.exportInfo.baseCompacted,true);
  assert.equal(error.exportInfo.baseMetadata[0].metadataAttributes,4);return true;
 });assert.deepEqual(f.order,[]);assert.equal(f.handles.size,0);
});
test('explicit compacted Base still permits readable partial ExeFS without the failed resolver experiment',async()=>{
 const f=baseFixture({compacted:true});const r=await f.prepare();
 assert.equal(r.exportInfo.partial,true);assert.equal(r.exportInfo.baseCompacted,true);
 assert.ok(r.exportInfo.sections.some(s=>s.path==='/base/exefs'&&s.status==='available'));
});
test('unreadable compacted Base retains the real ExeFS result and RomFS evidence',async()=>{
 const f=baseFixture({compacted:true,codeResult:0xa2e44802});await assert.rejects(f.prepare(),error=>{
  assert.equal(error.exportInfo.baseCompacted,true);
  assert.equal(error.cause.nativeResult.canonical,0x244802);
  assert.ok(error.exportInfo.sections.some(s=>s.path==='/base/romfs'&&s.status==='invalid'));return true;
 });
});

test('unsupported original-content manual preserves readable sections and marks export partial',async()=>{
 const f=baseFixture({manualError:Object.assign(Error('Manual requires original-content mount'),{code:'GAME_ORIGINAL_CONTENT_REQUIRED'})});
 const result=await f.prepare({});
 assert.equal(result.exportInfo.partial,true);
 assert.ok(result.exportInfo.sections.some(s=>s.path==='/base/manual'&&s.status==='unavailable'&&s.code==='GAME_ORIGINAL_CONTENT_REQUIRED'));
 assert.ok(result.exportInfo.sections.some(s=>s.path==='/base/exefs'&&s.status==='available'));
});

test('manual cleanup or transport failure still aborts instead of reporting partial success',async()=>{
 for(const error of [Object.assign(Error('close failed'),{code:'GAME_ORIGINAL_CONTENT_REQUIRED',cleanupBlocked:true}),Error('Network failure')]){
  const f=baseFixture({manualError:error});await assert.rejects(f.prepare({}),failure=>failure===error);
 }
});
