'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {discoverExports,prepareExport,prepareSystemTitle,prepareFirmwareNcas,walkFilesystem,FIRMWARE_ID}=require('../vendor/OunceCake/engine/exports.cjs');
const mounts=require('../vendor/OunceCake/engine/mounts.cjs');
const {catalogEntries}=require('./gui-ouncecake.cjs');
const {validCatalog}=require('./gui-attach.cjs');
const id='0100000000000001',nca='0123456789abcdef0123456789abcdef.nca';
function fixture(tree){
 let next=100,buffer;const positions=new Map(),dirs=new Map(),trace=[];
 const s={base:2**32,handles:new Set([10,40]),threads:new Set(),
  async ipc(label,handle,command,input){
   trace.push({label,handle,command,input});
   if(command===110){assert.equal(input.readUInt32LE(),0);return {result:0,handle:10};}
   assert.equal(command,0);assert.ok(dirs.has(handle));
   const directory=dirs.get(handle),at=positions.get(handle)||0,entries=tree[directory];assert.ok(entries,'unexpected '+directory);
   const rows=entries.slice(at,at+32);positions.set(handle,at+rows.length);buffer=Buffer.alloc(rows.length*0x310);
   rows.forEach((row,i)=>{const at=i*0x310;buffer.write(row.name,at);buffer[at+0x304]=row.type==='directory'?0:1;buffer.writeBigUInt64LE(BigInt(row.size||0),at+0x308);});
   const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt(rows.length));return {result:0,data};
  },
  async readOwned(){return buffer;},async write(){},async close(h){trace.push({closed:h});this.handles.delete(h);},
 };
 const attachment={s,root:1,domain:{oneHandle(reply){s.handles.add(reply.handle);return reply.handle;}},filesystem:{
  async pathMethod(s,handle,command,directory,mode){assert.equal(command,9);assert.equal(mode.readUInt32LE(),3);const h=next++;dirs.set(h,directory);return {result:0,handle:h};},
 }};
 return {attachment,trace};
}
function indexFiles(index){
 const count=Number(index.readBigUInt64LE(16)),strings=Number(index.readBigUInt64LE(32));const result=[];
 const string=offset=>index.toString('utf8',strings+offset,index.indexOf(0,strings+offset));
 for(let i=0;i<count;i++){const at=64+i*48;if(index.readUInt32LE(at+12)===1)result.push({name:string(index.readUInt32LE(at+16)),sourcePath:string(index.readUInt32LE(at+28)),mount:index.readUInt32LE(at+24)});}
 return result;
}
test('catalog includes raw firmware and newest system titles even without installed games',async()=>{
 const calls=[];const content={async discoverGames(){calls.push('games');return [];},async discoverSystemPrograms(){calls.push('programs');return [{contentTitle:id,version:1,storage:3},{contentTitle:id,version:2,storage:3}];},async discoverSystemData(){calls.push('data');return [{contentTitle:'0100000000000801',version:3,storage:3}];}};
 const result=await discoverExports({attachment:{},content});assert.deepEqual(calls,['games','programs','data']);assert.equal(result.length,3);
 assert.equal(result[0].title,FIRMWARE_ID);assert.equal(result[1].version,2);assert.equal(result[2].kind,'system-data');
 assert.equal(validCatalog(catalogEntries(result)),true);
 assert.equal(validCatalog([{titleId:id,name:'forged game',storages:[3]}]),false);
 assert.throws(()=>catalogEntries([{title:id,storages:[3],kind:'unknown'}]));
});
test('raw firmware exports every registered NCA with its original backing path',async()=>{
 const f=fixture({'/registered':[{name:'bucket',type:'directory'},{name:'ignore.txt',size:1}],'/registered/bucket':[{name:nca,size:123456}]});
 const result=await prepareFirmwareNcas({attachment:f.attachment});
 assert.deepEqual(result.sources,[{handle:10,kind:1,size:0}]);assert.deepEqual(indexFiles(result.index),[{name:nca,sourcePath:'/registered/bucket/'+nca,mount:0}]);
 assert.equal(result.exportInfo.files,1);assert.equal(result.exportInfo.bytes,123456);
 assert.equal(f.trace.filter(row=>row.closed).length,2);assert.ok(f.attachment.s.handles.has(10),'source must stay open until server stops');
 assert.deepEqual(f.trace.filter(row=>row.command!==undefined).map(row=>row.command),[110,0,0,0,0]);
});
test('duplicate NCA names cannot silently overwrite a firmware file',async()=>{
 const f=fixture({'/registered':[{name:'a',type:'directory'},{name:'b',type:'directory'}],'/registered/a':[{name:nca}],'/registered/b':[{name:nca}]});
 await assert.rejects(prepareFirmwareNcas({attachment:f.attachment}),/duplicate firmware NCA/);
});
for(const name of ['..','bad/name','bad\\name'])test('unsafe system directory entry rejected: '+name,async()=>{
 const f=fixture({'/':[{name}]});await assert.rejects(walkFilesystem({attachment:f.attachment,handle:40}),/unsafe directory name/);
 assert.equal(f.trace.filter(row=>row.closed).length,1);
});
test('oversized directory count is rejected before reading outside the owned buffer',async()=>{
 const f=fixture({'/':[]});f.attachment.s.ipc=async()=>{const data=Buffer.alloc(8);data.writeBigUInt64LE(33n);return {result:0,data};};
 f.attachment.s.readOwned=()=>assert.fail('must not read oversized data');
 await assert.rejects(walkFilesystem({attachment:f.attachment,handle:40}),/count exceeds/);assert.equal(f.trace.filter(row=>row.closed).length,1);
});
test('cancelled listing closes its directory without deploying or reading content',async()=>{
 const f=fixture({'/':[{name:nca}]});let count=0;
 await assert.rejects(walkFilesystem({attachment:f.attachment,handle:40,shouldStop:()=>++count>2}),error=>error.code==='FTP_CANCELLED');
 assert.equal(f.trace.filter(row=>row.closed).length,1);
});
test('SystemData uses DataId in system storage and preserves RomFS extents',async()=>{
 const f=fixture({}),entry={titleId:id,kind:'system-data',storages:[3],version:7};let opened=false;
 const result=await prepareSystemTitle({attachment:f.attachment,entry,
  content:{async resolveSystemDataContent(args){assert.equal(args.storage,3);return {storage:3,version:7};}},
  openDataStorage:async(a,title,storage)=>{assert.equal(title,id);assert.equal(storage,3);opened=true;return {handle:55,size:4096};},
  mounts:{...mounts,async readRomfs(read,size){assert.equal(size,4096);return [{path:'/file.bin',type:'file',size:10,offset:100}];}},
 });
 assert.equal(opened,true);assert.deepEqual(result.sources,[{handle:55,kind:0,size:4096}]);assert.equal(indexFiles(result.index)[0].name,'file.bin');
});
test('SystemProgram serves ExeFS when it has no RomFS section',async()=>{
 const f=fixture({'/':[{name:'main',size:32}]});f.attachment.domain.send=async()=>{const data=Buffer.alloc(8);data.writeBigUInt64LE(BigInt('0x'+id));return {result:0,data};};
 const result=await prepareSystemTitle({attachment:f.attachment,entry:{titleId:id,kind:'system-program',storages:[3],version:1},
  content:{async resolveProgramContent(){return {storage:3,version:1,contentPath:'@SystemContent://registered/'+nca,attributes:0};}},
  programMounts:()=>({async openCode(args){assert.equal(args.storage,3);assert.equal(args.title,id);return 40;}}),
  openProgramStorage:async()=>{throw {nativeResult:{canonical:0x7d202}};},
 });
 assert.equal(indexFiles(result.index)[0].name,'main');assert.deepEqual(result.exportInfo.absentSections,['romfs']);
});
test('changed system title version is refused before mounting',async()=>{
 await assert.rejects(prepareSystemTitle({attachment:{},entry:{titleId:id,kind:'system-data',storages:[3],version:1},
  content:{async resolveSystemDataContent(){return {storage:3,version:2};}}}),/changed since discovery/);
});
test('game preparation still uses the existing game/update/DLC pipeline',async()=>{
 let called=false;const value=await prepareExport({attachment:{},entry:{titleId:id},mounts:{async prepareGame(args){called=true;assert.equal(args.title,id);return 'game';}}});assert.equal(called,true);assert.equal(value,'game');
});

test('title folders preserve the game identity through category selection and sanitize Windows path characters',()=>{
 const {titleLabel}=require('../vendor/OunceCake/engine/exports.cjs');
 assert.equal(titleLabel({titleId:'0400486024dec000',name:'The Legend of Zelda: Ocarina of Time'}),'The Legend of Zelda Ocarina of Time [0400486024dec000]');
 assert.equal(titleLabel({titleId:id,name:'Base',titleName:'Game / Test?'}),'Game Test ['+id+']');
 assert.ok(Buffer.byteLength(titleLabel({titleId:id,name:'あ'.repeat(300)}))<=220);
});
test('title folder namespaces public paths without altering private NCA backing paths',()=>{
 const folder='The Legend of Zelda Ocarina of Time [0400486024dec000]';
 const index=mounts.buildIndex([{path:'/base/exefs',kind:'filesystem',mount:0,entries:[{path:'/main',sourcePath:'/original/main',type:'file',size:32}]}],folder);
 assert.equal(indexFiles(index)[0].sourcePath,'/original/main');
 const strings=Number(index.readBigUInt64LE(32));assert.ok(index.subarray(strings).includes(Buffer.from(folder+'\0')));
 assert.throws(()=>mounts.buildIndex([],'../escape'),/invalid export folder/);
});
test('selected category exports use the original title folder',async()=>{
 let root;await prepareExport({entry:{titleId:id,name:'Update',titleName:'Original Game',exportPart:'update'},part:'update',mounts:{async prepareGame(args){root=args.exportRoot;assert.equal(args.part,'update');return {};}}});assert.equal(root,'Original Game ['+id+']');
});

test('firmware export folder omits its internal sentinel identifier',()=>{assert.equal(require('../vendor/OunceCake/engine/exports.cjs').titleLabel({titleId:FIRMWARE_ID,name:'[Firmware] All registered original NCAs',kind:'firmware-nca'}),'[Firmware] All registered original NCAs');});
