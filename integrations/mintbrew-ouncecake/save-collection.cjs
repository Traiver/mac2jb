'use strict';
const fs=require('node:fs/promises'),path=require('node:path');
const {throwIfCancelled}=require('../../vendor/OunceCake/engine/protocol.cjs');
const component=value=>String(value||'Unknown').replace(/[\\/<>:"|?*\x00-\x1f\x7f]/g,' ').trim().replace(/[. ]+$/,'').slice(0,80)||'Unknown';
async function snapshotAll({attachment,archives,directory,shouldStop=()=>false,onProgress=()=>{},tools=require('./saves.cjs')}){
 if(!Array.isArray(archives)||!archives.length||archives.length>8192)throw Error('Invalid save collection inventory');
 for(const archive of archives){tools.validateArchive(archive);if(!tools.isGameSave(archive))throw Error('Only Account, Device or BCAT game archives can be included in a collection');}
 if(new Set(archives.map(tools.identity)).size!==archives.length)throw Error('Repeated save collection archive');
 throwIfCancelled(shouldStop);
 const current=await tools.inventory({attachment,shouldStop}),present=new Set(current.map(tools.identity));
 if(current.length!==archives.length||!archives.every(a=>present.has(tools.identity(a))))
  throw Error('The save inventory changed. Reopen Save Games and try again.');
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const folder=await fs.mkdtemp(path.join(directory,'all-saves-'));let complete=false;
 const entries=[],directories=new Set(),records=[],failed=[];let bytes=0,files=0,failure;
 try{
  await fs.mkdir(path.join(folder,'files'),{mode:0o700});
  for(let i=0;i<archives.length;i++){
   throwIfCancelled(shouldStop);const archive=archives[i];
   onProgress('OunceCake: Backing up save '+(i+1)+'/'+archives.length+': '+(archive.titleName||archive.titleId));
   let backup;const owned=new Set(attachment.s.handles);
   try{backup=await tools.snapshot({attachment,archive,directory:folder,shouldStop,onProgress,verifiedInventory:current});}
   catch(error){
    const blocked=e=>Boolean(e?.cleanupBlocked||e?.errors?.some(blocked));
    if([...attachment.s.handles].some(h=>!owned.has(h))||attachment.s.threads.size)error.cleanupBlocked=true;
    if(blocked(error)||error instanceof AggregateError||!error.nativeResult)throw error;
    failed.push({selection:archive,message:error.message,result:error.nativeResult.canonical});
    onProgress('OunceCake: Save archive unavailable: '+archive.titleId+' / '+archive.id+'; recorded in the collection manifest.');continue;
   }
   if([...attachment.s.handles].some(h=>!owned.has(h))||attachment.s.threads.size)
    throw Object.assign(Error('Save collection archive cleanup is incomplete'),{cleanupBlocked:true});
   const title=component(archive.titleName)+' ['+archive.titleId+']';
   const owner=archive.uid==='0'.repeat(32)?'Shared':component(archive.userName||'User')+' ['+archive.uid+']';
   const type={1:'Account',2:'BCAT',3:'Device',4:'Temporary',5:'Cache',7:'StreamPlay'}[archive.type];
   const leaf=type+' '+(archive.space===1?'NAND':'SD')+' ['+archive.id+']'+(archive.index?' index '+archive.index:'')+(archive.rank?' secondary':'');
   const relative=[title,owner,leaf].join('/'),target=path.join(folder,'files',relative);
   await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});await fs.rename(backup.folder,target);
   for(const p of [title,title+'/'+owner,relative,relative+'/files',...backup.manifest.directories.map(d=>relative+'/files/'+d)])directories.add(p);
   for(const entry of backup.manifest.entries)entries.push({...entry,path:relative+'/files/'+entry.path});
   const file=path.join(target,'manifest.json'),size=(await fs.stat(file)).size;
   entries.push({path:relative+'/manifest.json',size,sha256:await tools.hashFile(file)});
   files+=backup.manifest.files;bytes+=backup.manifest.bytes;
   records.push({path:relative,selection:archive,files:backup.manifest.files,bytes:backup.manifest.bytes});
   if(entries.length>1048576||!Number.isSafeInteger(bytes))throw Error('Save collection exceeds its file or byte-count limit');
  }
  throwIfCancelled(shouldStop);
  if(!records.length)throw Error('None of the selected save archives could be read. Close the games and try individual saves.');
  const manifest={format:'mac2jb.save-collection',version:1,created:new Date().toISOString(),readOnly:true,
   partial:failed.length>0,failed,archives:records,saveFiles:files,saveBytes:bytes,
   files:entries.length,bytes:entries.reduce((n,e)=>n+e.size,0),directories:[...directories],entries};
  await fs.writeFile(path.join(folder,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  complete=true;return {folder,manifest};
 }catch(error){failure=error;throw error;}
 finally{if(!complete)try{await fs.rm(folder,{recursive:true,force:true});}catch(error){
  if(failure)throw new AggregateError([failure,error],'Save collection and local cleanup failed');throw error;
 }}
}
module.exports={snapshotAll,component};
