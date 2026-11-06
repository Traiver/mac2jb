'use strict';
// Read-only save exports use the existing owned FS attachment, never a new exploit.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const attr=require('../../vendor/ns2-savekit/tools/lib/save-attr.cjs');
const {success,withCleanup,throwIfCancelled}=require('../../vendor/OunceCake/engine/protocol.cjs');
const TYPES={1:'Account',2:'BCAT',3:'Device',4:'Temporary',5:'Cache',7:'StreamPlay'};
// Include per-user Account saves, shared Device saves and game-related BCAT.
// Temporary, Cache and StreamPlay remain outside this browser's scope.
function isGameSave(a){
 if(!a||![1,2,3].includes(a.type)||!/^(01|04)[0-9a-f]{14}$/.test(a.titleId))return false;
 // Exclude the reserved system-title region. Switch application IDs start at
 // 0100000000010000; Switch 2 game IDs use the 04 platform prefix.
 return (BigInt('0x'+a.titleId)&0x00ffffffffffffffn)>=0x10000n;
}
const check=(v,m)=>{if(!v)throw Object.assign(Error(m),{code:'SAVE_EXPORT_FAILED'});};
const safeName=name=>typeof name==='string'&&name.length>0&&!['.','..'].includes(name)&&!/[\\/\x00-\x1f\x7f]/.test(name);
function parseRecord(bytes){
 check(bytes.length===0x60,'Invalid save archive record');
 return {id:bytes.readBigUInt64LE(0).toString(),space:bytes[8],type:bytes[9],rank:bytes[10],
  index:bytes.readUInt32LE(12),uid:bytes.subarray(16,32).toString('hex'),
  titleId:bytes.readBigUInt64LE(40).toString(16).padStart(16,'0'),size:bytes.readBigUInt64LE(48).toString()};
}
function validateArchive(a){
 check(a&&/^[0-9a-f]{16}$/.test(a.titleId)&&/^[0-9a-f]{32}$/.test(a.uid)&&/^[0-9]+$/.test(a.id)&&
  [1,4].includes(a.space)&&Object.hasOwn(TYPES,a.type)&&[0,1].includes(a.rank)&&
  Number.isInteger(a.index)&&a.index>=0&&a.index<=65535,'Unsupported save archive');
 return a;
}
const identity=a=>[a.id,a.space,a.type,a.rank,a.index,a.uid,a.titleId].join(':');
async function inventory({attachment,titleId,shouldStop=()=>false,includeAuxiliary=false}){
 check(titleId===undefined||/^[0-9a-f]{16}$/.test(titleId),'Invalid save title ID');
 const {s,root,domain}=attachment,archives=[];
 check(!s.threads.size,'Save enumeration requires an idle attachment');
 for(const space of [1,4]){
  throwIfCancelled(shouldStop);
  const reply=await s.ipc('OpenSaveDataInfoReader',root,61,Buffer.from([space]));
  // SaveKit docs/RESULTS.md: SdUser reports 0x137e02 when no SD is inserted.
  // Only that exact, handle-free absence is optional; other failures stay visible.
  if(space===4&&(Number(reply.canonicalResult??reply.result)&0x3fffff)===0x137e02&&
    !reply.moves?.length&&!reply.copies?.length)continue;
  const reader=domain.oneHandle(success(reply,'Open save archive index'));
  await withCleanup(async()=>{
   for(let page=0;page<64;page++){
    throwIfCancelled(shouldStop);
    const address=s.base+0x8000;
    await s.write(address,Buffer.alloc(64*0x60));
    const read=success(await s.ipc('ReadSaveDataInfo',reader,0,Buffer.alloc(0),
     {receive:[{address,size:64*0x60,mode:0}]}),'Read save archive index');
    check(read.data?.length>=8,'Truncated save archive count');
    const count=Number(read.data.readBigUInt64LE());
    check(Number.isSafeInteger(count)&&count>=0&&count<=64,'Invalid save archive count');
    if(!count)return;
    const bytes=await s.read(address,count*0x60);
    check(bytes.length===count*0x60,'Truncated save archive index');
    for(let i=0;i<count;i++){
     const a=parseRecord(bytes.subarray(i*0x60,(i+1)*0x60));
     check(a.space===space,'Save archive space differs from its index');
     if((titleId===undefined||a.titleId===titleId)&&Object.hasOwn(TYPES,a.type)&&(includeAuxiliary||isGameSave(a)))archives.push(validateArchive(a));
    }
    if(count<64)return;
   }
   check(false,'Save archive index exceeds its page limit');
  },()=>s.close(reader));
 }
 check(new Set(archives.map(identity)).size===archives.length,'Duplicate save archive identity');
 check(archives.length<=8192,'Save archive inventory exceeds its limit');
 return archives.sort((a,b)=>a.uid.localeCompare(b.uid)||a.type-b.type||a.index-b.index||a.rank-b.rank||a.space-b.space);
}
function label(a){return (a.uid==='0'.repeat(32)?'Shared':a.userName?a.userName+(a.duplicateName?' ['+a.uid+']':''):'User '+a.uid)+' / '+TYPES[a.type]+
 ' / '+(a.space===1?'NAND':'SD')+' / Index '+a.index+(a.rank?' / Secondary':'');}
async function hashFile(file){
 const handle=await fs.open(file,'r'),hash=crypto.createHash('sha256');
 try{for await(const bytes of handle.createReadStream({autoClose:false}))hash.update(bytes);}
 finally{await handle.close();}
 return hash.digest('hex');
}
async function snapshot({attachment,archive,directory,shouldStop=()=>false,onProgress=()=>{},verifiedInventory}){
 validateArchive(archive);check(isGameSave(archive),'Only Account, Device or BCAT game archives can be exported');throwIfCancelled(shouldStop);
 const {s,root,domain,filesystem}=attachment;
 // Recheck the exact index entry before opening; never guess another user/archive.
 const current=verifiedInventory||await inventory({attachment,titleId:archive.titleId,shouldStop});
 check(current.some(a=>identity(a)===identity(archive)),'Selected save archive is no longer installed');
 check(!s.threads.size,'Save export requires an idle attachment');
 const input=attr.build({...archive,referenceId:BigInt('0x'+archive.titleId),uid:Buffer.from(archive.uid,'hex')});
 const handle=domain.oneHandle(success(await s.ipc('OpenReadOnlySaveDataFileSystem',root,53,input),
  'Open save read-only (close the game before exporting)'));
 let folder,complete=false;
 try{
  return await withCleanup(async()=>{
   await fs.mkdir(directory,{recursive:true,mode:0o700});
   folder=await fs.mkdtemp(path.join(directory,archive.titleId+'-'));
   await fs.mkdir(path.join(folder,'files'),{mode:0o700});
   const entries=[],directories=[],seen=new Set();let total=0,items=0;
   async function walk(remote,depth=0){
    throwIfCancelled(shouldStop);check(depth<=32,'Save directory tree is too deep');
    const rows=await filesystem.listDirectory(s,handle,remote,65536);
    for(const row of rows){
     throwIfCancelled(shouldStop);check(safeName(row.name),'Unsafe name in save archive');
     const full=(remote==='/'?'':remote)+'/'+row.name,relative=full.slice(1);
     check(!seen.has(full)&&++items<=65536,'Duplicate or excessive save entries');seen.add(full);
     const target=path.join(folder,'files',relative);
     if(row.type===0){directories.push(relative);await fs.mkdir(target,{mode:0o700});await walk(full,depth+1);continue;}
     check(row.type===1,'Unknown entry type in save archive');
     const opened=await filesystem.openFile(s,handle,full);
     success(opened,'Open save file '+full);check(Number.isInteger(opened.handle)&&opened.handle>0,'Missing save file handle');
     await withCleanup(async()=>{
      const size=Number(await filesystem.fileSize(s,opened.handle));
      check(Number.isSafeInteger(size)&&size>=0&&size===Number(row.size),'Save file size changed: '+full);
      check(Number.isSafeInteger(total+size),'Save export is too large');
      const local=await fs.open(target,'wx',0o600),hash=crypto.createHash('sha256');
      try{
       for(let offset=0;offset<size;){
        throwIfCancelled(shouldStop);
        const amount=Math.min(0x40000,size-offset),bytes=await filesystem.readFile(s,opened.handle,offset,amount);
        check(Buffer.isBuffer(bytes)&&bytes.length===amount,'Short save file read: '+full);
        let written=0;while(written<bytes.length){const r=await local.write(bytes,written,bytes.length-written);check(r.bytesWritten>0,'Could not write save backup');written+=r.bytesWritten;}
        hash.update(bytes);offset+=bytes.length;
       }
       check(Number(await filesystem.fileSize(s,opened.handle))===size,'Save file size changed during export');
       await local.sync();
      }finally{await local.close();}
      const sha256=hash.digest('hex');
      check(await hashFile(target)===sha256,'Local save backup checksum mismatch: '+full);
      entries.push({path:relative,size,sha256});total+=size;
      onProgress('OunceCake: Save backup: '+entries.length+' files, '+total+' bytes');
     },()=>s.close(opened.handle));
    }
   }
   await walk('/');throwIfCancelled(shouldStop);
   const manifest={format:'mac2jb.save-backup',version:1,created:new Date().toISOString(),
    titleId:archive.titleId,selection:archive,readOnly:true,partial:false,files:entries.length,bytes:total,
    directories,entries};
   await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
   complete=true;return {folder,manifest};
  },()=>s.close(handle));
 }catch(error){complete=false;throw error;}
 finally{if(folder&&!complete)await fs.rm(folder,{recursive:true,force:true});}
}
module.exports={inventory,snapshot,label,parseRecord,validateArchive,identity,safeName,hashFile,isGameSave,
 withProfiles:require('./save-profiles.cjs').decorate,
 titleNames:require('./save-library.cjs').titleNames,snapshotAll:require('./save-collection.cjs').snapshotAll};
