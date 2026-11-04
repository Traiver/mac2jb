'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runPreparation,canRawFallback}=require('../vendor/OunceCake/engine/preparation.cjs');
const {nativeOwners,prepareNativeInstalledLicense}=require('../vendor/OunceCake/engine/native-license.cjs');
const {prepareTitleNcas,prepareExport}=require('../vendor/OunceCake/engine/exports.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('missing installed ELicense is a typed recoverable content error',async()=>{
 await assert.rejects(nativeOwners(async()=>({data:Buffer.alloc(4),output:Buffer.alloc(0)}),'0400486024dec000'),error=>error.code==='MISSING_ELICENSE'&&canRawFallback(error));
});
test('license enumeration checks cancellation before sending another ES request',async()=>{
 await assert.rejects(nativeOwners(()=>assert.fail('must not call ES'),'0400486024dec000',{shouldStop:()=>true}),error=>error.code==='FTP_CANCELLED');
});
test('only content/license failures allow automatic raw fallback',()=>{
 for(const code of ['MISSING_ELICENSE','ELICENSE_UNUSABLE','GAME_ORIGINAL_CONTENT_REQUIRED'])assert.equal(canRawFallback({code}),true);
 assert.equal(canRawFallback(Error('Memory request timed out')),false);
 assert.equal(canRawFallback({code:'MISSING_ELICENSE',cleanupBlocked:true}),false);
 assert.equal(canRawFallback(new AggregateError([{code:'MISSING_ELICENSE'},Error('close failed')])),false);
 assert.equal(canRawFallback(new Error('Could not prepare',{cause:{code:'MISSING_ELICENSE'}})),true);
});
test('deadline never races an unfinished operation against cleanup',async()=>{
 let release,finished=false,settled=false;const messages=[];const gate=new Promise(resolve=>release=resolve);
 const pending=runPreparation(async()=>{await gate;finished=true;return 'late native result';},{timeoutMs:10,progressMs:100,onProgress:s=>messages.push(s)});
 pending.then(()=>settled=true,()=>settled=true);
 await sleep(25);assert.equal(settled,false);assert.equal(finished,false);assert.ok(messages.some(s=>s.includes('current console operation')));
 release();await assert.rejects(pending,error=>error.code==='PREPARATION_TIMEOUT');assert.equal(finished,true);
});
test('cooperative deadline waits for the operation finally block before reporting timeout',async()=>{
 let cleaned=false;
 await assert.rejects(runPreparation(async shouldStop=>{
  try{while(!shouldStop())await sleep(2);throw Object.assign(Error('cancelled'),{code:'FTP_CANCELLED'});}finally{await sleep(3);cleaned=true;}
 },{timeoutMs:10}),error=>error.code==='PREPARATION_TIMEOUT');assert.equal(cleaned,true);
});
test('a failed native restoration stays blocked even after deadline',async()=>{
 await assert.rejects(runPreparation(async()=>{await sleep(15);throw Object.assign(Error('restore failed'),{cleanupBlocked:true});},{timeoutMs:5}),error=>error.cleanupBlocked===true&&error.message==='restore failed');
});
function rawFixture(){
 const trace=[],handles=new Set([1]),ids=['a'.repeat(32),'b'.repeat(32)];let next=20;
 const a={root:1,s:{handles,threads:new Set(),async ipc(label,root,command,input){trace.push(['open-storage',command,input.readUInt32LE()]);assert.equal(command,110);return {result:0,handle:10};},async close(h){handles.delete(h);trace.push(['close',h]);}},
  domain:{oneHandle(r){handles.add(r.handle);return r.handle;}},
  filesystem:{async openFile(s,h,name){trace.push(['read-only-open',h,name]);const handle=next++;handles.add(handle);return {result:0,handle};},async fileSize(){return 123n;}}};
 const content={async discoverUpdates(){return [{storage:5,contentTitle:'0400486024dec800',version:2}];},async discoverDlc(){return [];},
  async resolveContent(args){trace.push(['resolve',args.storage,args.contentType,Boolean(args.update)]);
   if(args.contentType!==1)throw {nativeResult:{canonical:0xe05}};
   return {storage:args.storage,contentId:ids[args.update?1:0],contentPath:'@UserContent://registered/0000005D/'+ids[args.update?1:0]+'.nca'};}};
 return {a,content,trace};
}
test('raw title export opens original base and update files without preparing any license',async()=>{
 const f=rawFixture();const result=await prepareTitleNcas({attachment:f.a,entry:{titleId:'0400486024dec000',storages:[4]},content:f.content});
 assert.equal(result.exportInfo.decryptionAttempted,false);assert.equal(result.exportInfo.files,2);assert.equal(result.sources.length,2);
 assert.deepEqual(f.trace.filter(r=>r[0]==='open-storage').map(r=>r[2]),[1,2]);
 assert.equal(f.trace.filter(r=>r[0]==='close').length,2);assert.ok(f.a.s.handles.has(10));
 const strings=Number(result.index.readBigUInt64LE(32));const text=result.index.subarray(strings).toString();assert.ok(text.includes('/registered/0000005D/'));assert.ok(text.includes('.nca'));
});
test('explicit raw selection never attempts the decrypted game pipeline',async()=>{
 const f=rawFixture();const result=await prepareExport({raw:true,attachment:f.a,entry:{titleId:'0400486024dec000',storages:[4]},content:f.content,
  mounts:{buildIndex:require('../vendor/OunceCake/engine/mounts.cjs').buildIndex,prepareGame:()=>assert.fail('must not prepare ELicense or decrypted views')}});
 assert.equal(result.exportInfo.kind,'game-nca');
});
test('unsafe NCA backing paths are refused before opening a file',async()=>{
 const f=rawFixture();f.content.resolveContent=async()=>({storage:4,contentId:'a'.repeat(32),contentPath:'@UserContent://../outside.nca'});
 await assert.rejects(prepareTitleNcas({attachment:f.a,entry:{titleId:'0400486024dec000',storages:[4]},content:f.content}),/unsafe NCA/);
 assert.equal(f.trace.some(r=>r[0]==='read-only-open'),false);
});

test('content without a RightsId needs neither ES enumeration nor an ELicense context',async()=>{
 let queried=0;const result=await prepareNativeInstalledLicense({programId:'0400486024dec000',storage:4,
  s:{threads:new Set(),async ipc(label,root,command){assert.equal(command,606);queried++;return {result:0,data:Buffer.alloc(16)};}},root:1,
  domain:{},service:()=>assert.fail('no ES request is needed for content without a RightsId')});
 assert.equal(result,false);assert.equal(queried,1);
});

test('full multi-content exports receive a bounded ten-minute default budget',()=>{assert.equal(require('../vendor/OunceCake/engine/preparation.cjs').DEFAULT_TIMEOUT_MS,600000);});
