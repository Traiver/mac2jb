'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {discoverBase,discoverDataPatches,discoverSystemPrograms}=require('../vendor/OunceCake/engine/content.cjs');
const {buildIndex}=require('../vendor/OunceCake/engine/mounts.cjs');
const {prepareTitleNcas}=require('../vendor/OunceCake/engine/exports.cjs');
const title='0100000000001000';
function metadataFixture({type=0x80,headerSize=16,truncate=false,metadataAttributes=0,installType=0,contentBytes=0}={}){
 const key=Buffer.alloc(16);key.writeBigUInt64LE(BigInt('0x'+title));key[12]=type;key[13]=installType;
 const meta=Buffer.alloc(8+headerSize+48);meta.writeUInt16LE(headerSize);meta.writeUInt16LE(2,2);meta[6]=metadataAttributes;
 if(headerSize>=16){meta.writeBigUInt64LE(0x0100000000002000n,8);meta.writeBigUInt64LE(BigInt('0x'+title),16);}
 for(let i=0;i<2;i++){const at=8+headerSize+i*24;meta.fill(i+1,at,at+16);meta.writeUIntLE(contentBytes,at+16,5);meta[at+21]=1;meta[at+22]=i?4:1;meta[at+23]=i?3:0;}
 let output;const closed=[];
 const a={s:{base:2**32,bytes:0x80000,async close(h){closed.push(h);this.handles.delete(h);},handles:new Set([5]),
  async readOwned(){return output;},async ipc(label,h,command,input){
   if(label.startsWith('Open '))return {result:0,handle:5};
   if(command===5){output=Buffer.alloc(512);key.copy(output);const data=Buffer.alloc(8);data.writeInt32LE(1);data.writeInt32LE(1,4);return {result:0,data};}
   if(command===10){const data=Buffer.alloc(4);data.writeUInt32LE(meta.length);return {result:0,data};}
   if(command===1){output=truncate?meta.subarray(0,10):meta;return {result:0};}
   assert.fail('unexpected IPC '+command);
  }},domain:{oneHandle:r=>r.handle},service:async()=>1};return {a,closed};
}
test('base discovery preserves every program index and manual content',async()=>{
 const {a}=metadataFixture();const rows=await discoverBase({...a,title,storages:[4]});
 assert.equal(rows.length,1);assert.equal(rows[0].contents.length,2);assert.equal(rows[0].contents[1].programIndex,3);assert.equal(rows[0].contents[1].contentType,4);
});
test('DLC update discovery reads original DLC identity and validates application ownership',async()=>{
 const {a}=metadataFixture({type:0x84});const rows=await discoverDataPatches({...a,title,storages:[4]});
 assert.equal(rows[0].dataTitle,'0100000000002000');assert.equal((await discoverDataPatches({...a,title:'0100000000009999',storages:[4]})).length,0);
});
test('truncated metadata is rejected and the database closes',async()=>{
 const {a,closed}=metadataFixture({truncate:true});await assert.rejects(discoverBase({...a,title,storages:[4]}),/Truncated content metadata/);assert.deepEqual(closed,[5]);
});
test('system discovery does not reinterpret system metadata as game packages',async()=>{
 const {a}=metadataFixture({type:1,headerSize:0});a.s.ipc=async(label,h,command)=>{
  if(label.startsWith('Open '))return {result:0,handle:5};assert.equal(command,5);const data=Buffer.alloc(8);return {result:0,data};
 };assert.deepEqual(await discoverSystemPrograms(a),[]);
});
test('deferred filesystem index preserves NCA backing path and relative file name',()=>{
 const backing='@UserContent://registered/'+'a'.repeat(32)+'.nca';
 const b=buildIndex([{path:'/base/program/0',kind:'deferred-filesystem',source:{contentPath:backing},mount:0,entries:[{path:'/index.html',type:'file',size:17}]}]);
 const strings=Number(b.readBigUInt64LE(32));const count=Number(b.readBigUInt64LE(16));
 for(let i=0;i<count;i++){const at=64+i*48;if(!b.readUInt32LE(at+12))continue;
  const read=n=>b.toString('utf8',strings+n,b.indexOf(0,strings+n));assert.equal(read(Number(b.readBigUInt64LE(at+32))),backing);assert.equal(read(b.readUInt32LE(at+28)),'/index.html');
 }
});
test('raw export includes secondary programs and DLC updates without FS618 or ELicense',async()=>{
 const records=[{storage:4,contentTitle:title,version:0,contents:[{contentType:1,programIndex:0,contentId:'a'.repeat(32)},{contentType:1,programIndex:2,contentId:'b'.repeat(32)}]}];
 const patch={storage:4,contentTitle:'0100000000003000',version:1,contents:[{contentType:2,programIndex:0,contentId:'c'.repeat(32)}]};
 const seen=[];const handles=new Set();const a={root:1,s:{handles,async ipc(){return {result:0,handle:3};},async close(h){handles.delete(h);}},domain:{oneHandle(r){handles.add(r.handle);return r.handle;}},filesystem:{async openFile(){return {result:0,handle:4};},async fileSize(){return 32n;}}};
 const content={discoverBase:async()=>records,discoverUpdates:async()=>[],discoverDlc:async()=>[],discoverDataPatches:async()=>[patch],async resolveContent(args){assert.equal(args.root,undefined);assert.ok(args.content);seen.push(args.content.contentId);return {storage:4,contentId:args.content.contentId,contentPath:'@UserContent://registered/'+args.content.contentId+'.nca'};}};
 const result=await prepareTitleNcas({attachment:a,entry:{titleId:title,storages:[4]},content});assert.equal(result.exportInfo.files,3);assert.deepEqual(seen,['a'.repeat(32),'b'.repeat(32),'c'.repeat(32)]);
});

test('a failed resolver restoration blocks retry and raw fallback',async()=>{
 const {withCleanup}=require('../vendor/OunceCake/engine/protocol.cjs');
 const {canRawFallback}=require('../vendor/OunceCake/engine/preparation.cjs');
 await assert.rejects(withCleanup(async()=>42,async()=>{throw Object.assign(Error('restore failed'),{nativeResult:{canonical:0xe05}});}),error=>error.cleanupBlocked===true&&!canRawFallback(error));
});
test('NSO activation follows successful legacy ES preparation',async()=>{
 const {prepareInstalledLicense}=require('../vendor/OunceCake/engine/program.cjs');
 const calls=[];const handles=new Set([4,9]);const source={selection:'update',applicationTitle:title,contentTitle:'0100000000001800',metaType:0x81,contentType:1,storage:4,attributes:0,contentPath:'@UserContent://registered/test.nca',contentId:'a'.repeat(32)};
 const s={base:2**32,handles,installedLicenseContext:{handle:9},async write(){},async close(h){handles.delete(h);},async ipc(label,h,command){
  calls.push(command);if(command===4)return {result:0,handle:4};
  const data=Buffer.alloc(17);if(command===20)data[0]=1;return {result:0,data};
 }};
 const domain={oneHandle:r=>r.handle,async send(){const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt('0x'+title));return {result:0,data};}};
 assert.equal(await prepareInstalledLicense({s,root:1,domain,service:async()=>2,title,source}),true);assert.deepEqual(calls,[4,20,503,102]);
});

test('split categories retain every section exactly once',()=>{
 const {includeSection}=require('../vendor/OunceCake/engine/mounts.cjs');
 const all=['base','update','dlc','additional'];
 for(const category of ['base','update','dlc'])for(const [type,sections] of [[0,['meta']],[1,['romfs','exefs','logo']],[2,['romfs']],[3,['control']],[4,['manual']],[5,['legal']]])for(const section of sections){
  const matches=all.filter(part=>includeSection(part,category,type,section));assert.equal(matches.length,1);assert.equal(matches[0],type===1&&section!=='logo'||type===2?category:'additional');assert.equal(includeSection(undefined,category,type,section),true);
 }
});


test('base discovery retains compaction, installation type and 40-bit content sizes independently',async()=>{
 const {a}=metadataFixture({metadataAttributes:4,installType:0,contentBytes:2871181552});
 const [base]=await discoverBase({...a,title,storages:[4]});
 assert.equal(base.compacted,true);assert.equal(base.metadataAttributes,4);assert.equal(base.installType,0);
 assert.equal(base.contents[0].expectedBytes,2871181552);assert.equal(base.contents[0].attributes,1);
});
