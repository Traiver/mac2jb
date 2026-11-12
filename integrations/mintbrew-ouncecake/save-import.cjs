'use strict';
// Based on ns2-savekit/tools/save-write-stage.cjs (bundled source and license).
// SaveKit's 51 -> write/flush -> commit -> 53/readback sequence, on the
// existing OunceCake attachment. No new exploit, root session or native worker.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const saves=require('./saves.cjs'),files=require('./save-import-files.cjs');
const attr=require('../../vendor/ns2-savekit/tools/lib/save-attr.cjs');
const {success,withCleanup,pathRequest,throwIfCancelled}=require('../../vendor/OunceCake/engine/protocol.cjs');
const check=(v,m)=>{if(!v)throw Object.assign(Error(m),{code:'SAVE_IMPORT_FAILED'});};
const u32=v=>{const b=Buffer.alloc(4);b.writeUInt32LE(v);return b;};
const u64=v=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(v));return b;};
const inventoryKey=m=>JSON.stringify({entries:[...m.entries].sort((a,b)=>a.path.localeCompare(b.path)),directories:[...m.directories].sort()});
async function restore({attachment,archive,folder,digest,confirmed=false,directory,exportBackup,shouldStop=()=>false,onProgress=()=>{},onState=async()=>{},saveTools=saves}){
 check(confirmed===true,'Confirm the selected save import before writing');files.supported(archive);
 const {s,root,domain,filesystem}=attachment;
 check(s.threads.size===0&&s.bytes>=0x60000&&Number.isSafeInteger(s.base)&&s.base>0,'Import requires an idle, owned FS attachment');
 const request=await files.requestAt(folder);
 check(attachment.live?.session===request.sourceSession,'The save import belongs to another held console session');
 check((request.transport==='webdav')===Boolean(exportBackup),'The current WebDAV export backup is required for this import');
 const plan=await files.planAt(folder,digest);
 check(saves.identity(plan.archive)===saves.identity(archive),'Import target changed');throwIfCancelled(shouldStop);
 let backup,mutating=false,committed=false,writableAttempted=false,writableOpened=false;
 const state=async(phase,extra={})=>onState({phase,backupPath:backup?.folder,...extra});
 try{
  let candidate;
  if(exportBackup){
   await state('checking');onProgress('OunceCake: Checking the existing export backup. Keep the game closed.');
   check(path.isAbsolute(exportBackup)&&await fs.realpath(exportBackup)===exportBackup,'Invalid export backup folder');
   candidate={folder:exportBackup,manifest:await files.json(path.join(exportBackup,'manifest.json'))};
  }else{
   await state('backup');onProgress('OunceCake: Backing up the current save before import. Keep the game closed.');
   candidate=await saveTools.snapshot({attachment,archive,directory:path.join(directory,'before-import'),shouldStop,onProgress});
  }
  const manifest=candidate.manifest;
  check(manifest.format==='mac2jb.save-backup'&&manifest.partial===false&&manifest.readOnly===true&&
   manifest.titleId===archive.titleId&&manifest.selection&&saves.identity(manifest.selection)===saves.identity(archive)&&
   Array.isArray(manifest.entries)&&Array.isArray(manifest.directories)&&manifest.files===manifest.entries.length,
   'The backup does not match the selected save archive');
  // Confirm the on-disk backup is intact before permitting a writable mount.
  for(const e of manifest.entries){
   throwIfCancelled(shouldStop);check(files.validPath(e.path),'Invalid save backup path');
   const local=path.join(candidate.folder,'files',e.path),info=await fs.lstat(local);
   check(info.isFile()&&await fs.realpath(local)===local&&info.size===e.size&&await saves.hashFile(local)===e.sha256,'The save backup failed verification');
  }
  backup=candidate;
  await state('checking');
  const fresh=await saveTools.snapshot({attachment,archive,manifestOnly:true,shouldStop,onProgress});
  check(inventoryKey(fresh.manifest)===inventoryKey(backup.manifest),exportBackup?
   'The live save changed. Close the game and reopen the save export.':
   'The live save changed after backup. Close the game and prepare a new import.');
  // Revalidate staged bytes after the potentially lengthy backup, then recheck
  // the exact live archive identity. Never substitute a different user or save.
  await files.planAt(folder,digest);
  const current=await saveTools.inventory({attachment,titleId:archive.titleId,shouldStop});
  check(current.some(a=>saves.identity(a)===saves.identity(archive)),'Selected save archive is no longer installed');
  throwIfCancelled(shouldStop);check(s.threads.size===0,'Import attachment is no longer idle');
  const input=attr.build({...archive,referenceId:BigInt('0x'+archive.titleId),uid:Buffer.from(archive.uid,'hex')});
  await state('writing');
  writableAttempted=true;
  const save=domain.oneHandle(success(await s.ipc('Open save read-write',root,51,input),'Open save read-write'));writableOpened=true;
  await withCleanup(async()=>{
   // After opening writable, cancellation is deferred through commit/readback.
   // Do not kill or retry a native write. A missing source path never deletes it.
   const expectedFiles=new Map(backup.manifest.entries.map(e=>[e.path,e]));
   const expectedDirs=new Set(backup.manifest.directories);
   for(const d of plan.directories)check(!expectedFiles.has(d),'A directory would replace a save file: '+d);
   for(const e of plan.entries)check(!expectedDirs.has(e.path),'A file would replace a save directory: '+e.path);
   const directories=new Set(plan.directories);
   for(const e of plan.entries){const parts=e.path.split('/');for(let i=1;i<parts.length;i++)directories.add(parts.slice(0,i).join('/'));}
   for(const d of [...directories].sort((a,b)=>a.split('/').length-b.split('/').length||a.localeCompare(b))){
    if(expectedDirs.has(d))continue;
    const name='/'+d;check(files.validPath(d),'Invalid directory path');
    const address=s.base+0x2000,bytes=Buffer.alloc(0x304);Buffer.from(name).copy(bytes);await s.write(address,bytes);
    mutating=true;success(await domain.send(s,'Create save directory '+name,save,pathRequest(2,Buffer.alloc(0),address)),'Create save directory '+name);
   }
   for(let index=0;index<plan.entries.length;index++){
    const e=plan.entries[index],name='/'+e.path;
    const local=await fs.open(path.join(plan.stageRoot,e.path),'r');
    try{
     const st=await local.stat();check(st.isFile()&&st.size===e.size,'Staged file size changed');
     if(!expectedFiles.has(e.path)){
      const address=s.base+0x2000,bytes=Buffer.alloc(0x304);Buffer.from(name).copy(bytes);await s.write(address,bytes);
      const input=Buffer.alloc(16);input.writeBigUInt64LE(BigInt(e.size),8);
      mutating=true;success(await domain.send(s,'Create save file '+name,save,pathRequest(0,input,address)),'Create save file');
     }
     const file=domain.oneHandle(success(await filesystem.pathMethod(s,save,8,name,u32(3)),'Open save file for writing'));
     await withCleanup(async()=>{
      mutating=true;success(await s.ipc('Set save file size',file,3,u64(e.size)),'Set save file size');
      const hash=crypto.createHash('sha256');
      for(let offset=0;offset<e.size;){
       const bytes=Buffer.alloc(Math.min(0x40000,e.size-offset));
       let read=0;while(read<bytes.length){const r=await local.read(bytes,read,bytes.length-read,offset+read);check(r.bytesRead>0,'Short staged file read');read+=r.bytesRead;}
       hash.update(bytes);const address=s.base+0x20000;await s.write(address,bytes);
       success(await s.ipc('Write save file',file,1,Buffer.concat([u32(0),u32(0),u64(offset),u64(bytes.length)]),
        {send:[{address,size:bytes.length,mode:1}]}),'Write save file');offset+=bytes.length;
      }
      check(hash.digest('hex')===e.sha256,'Staged bytes changed while writing');
      success(await s.ipc('Flush save file',file,2),'Flush save file');
     },()=>s.close(file));
    }finally{await local.close();}
    onProgress('OunceCake: Importing save: '+(index+1)+' / '+plan.files+' files');
   }
   success(await s.ipc('Commit save data filesystem',save,10),'Commit save data filesystem');committed=true;
  },()=>s.close(save));
  await state('verifying');onProgress('OunceCake: Reopening the committed save read-only for verification.');
  const verified=await saveTools.snapshot({attachment,archive,directory:path.join(directory,'after-import'),shouldStop:()=>false,onProgress});
  const expected=new Map(backup.manifest.entries.map(e=>[e.path,e]));for(const e of plan.entries)expected.set(e.path,e);
  const actual=new Map(verified.manifest.entries.map(e=>[e.path,e]));
  check(actual.size===expected.size,'Unexpected files after import');
  for(const [name,e] of expected){const got=actual.get(name);check(got&&got.size===e.size&&got.sha256===e.sha256,'Imported or preserved file failed verification: '+name);}
  for(const d of [...backup.manifest.directories,...plan.directories])check(verified.manifest.directories.includes(d),'Save directory missing after import: '+d);
  const result={phase:'complete',backupPath:backup.folder,verifiedPath:verified.folder,files:plan.files,bytes:plan.bytes,committed:true,verified:true};
  await onState(result);return result;
 }catch(error){
  // A transport error can leave commit state unknown. Keep the verified backup,
  // stop this session and let the user decide about recovery; never auto-replay.
  if(mutating||(writableAttempted&&!writableOpened&&!error.nativeResult))error.cleanupBlocked=true;
  error.backupPath=backup?.folder;
  await state('failed',{message:error.message,committed,writeMayHaveOccurred:mutating,cleanupBlocked:Boolean(error.cleanupBlocked)}).catch(()=>{});
  throw error;
 }
}
module.exports={restore,inventoryKey};
