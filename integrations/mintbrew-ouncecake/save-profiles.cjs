'use strict';
const {TextDecoder}=require('node:util');
const {success,withCleanup,throwIfCancelled}=require('../../vendor/OunceCake/engine/protocol.cjs');
// libnx acc.c: GetUserExistence (1), GetProfile (5) -> IProfile.GetBase (1).
// AccountProfileBase: raw AccountUid[16], timestamp[8], UTF-8 nickname[32].
// The live Switch 2 can return a different profile ID. Bind names through the
// profile handle opened for the exact save UID, after verifying its existence.
function nickname(data){
 if(!Buffer.isBuffer(data)||data.length<56||!data.subarray(0,16).some(b=>b!==0))return;
 const bytes=data.subarray(24,56),end=bytes.indexOf(0);
 try{
  const name=new TextDecoder('utf-8',{fatal:true}).decode(end<0?bytes:bytes.subarray(0,end)).trim().normalize('NFC');
  if(name&&!/[\x00-\x1f\x7f-\x9f]/.test(name))return name;
 }catch{}
}
async function decorate({attachment,archives,shouldStop=()=>false,onProgress=()=>{}}){
 const uids=[...new Set(archives.map(a=>a.uid).filter(uid=>uid!=='0'.repeat(32)))];
 if(!uids.every(uid=>/^[a-f0-9]{32}$/.test(uid)))throw Error('Invalid save account UID');
 if(!uids.length)return archives;
 const {s,domain}=attachment,names=new Map();
 const warn=message=>onProgress('OunceCake: '+message+' Displaying the account ID instead.');
 throwIfCancelled(shouldStop);
 let account;
 try{account=await s.openService('acc:u0');}
 catch(error){
  if(error.message==='Service unavailable: acc:u0'){warn('Account names are unavailable.');return archives;}
  throw error;
 }
 await withCleanup(async()=>{
  success(await s.ipc('Initialize account profile reader',account,140,Buffer.alloc(8),{pid:true}),
   'Initialize account profile reader');
  for(const uid of uids){
   throwIfCancelled(shouldStop);
   try{
    const exists=success(await s.ipc('Check save account existence',account,1,Buffer.from(uid,'hex')),'Check save account existence');
    if(!Buffer.isBuffer(exists.data)||exists.data.length<1||exists.data[0]>1)throw Error('Invalid account existence reply');
    if(!exists.data[0])continue;
    throwIfCancelled(shouldStop);
    const opened=success(await s.ipc('Get account profile',account,5,Buffer.from(uid,'hex')),'Get account profile');
    const profile=domain.oneHandle(opened);
    await withCleanup(async()=>{
     throwIfCancelled(shouldStop);
     const base=success(await s.ipc('Read account profile name',profile,1),'Read account profile name');
     const name=nickname(base.data);
     if(name)names.set(uid,{name,profileId:base.data.subarray(0,16).toString('hex')});else warn('A profile name could not be read.');
    },()=>s.close(profile));
   }catch(error){
    if(error.nativeResult&&!error.cleanupBlocked){warn('A profile name could not be read: '+error.message);continue;}
    throw error;
   }
  }
 },()=>s.close(account)).catch(error=>{
  // A refused optional profile read can fall back after all owned handles close.
  // Transport errors, cancellation and uncertain cleanup must still propagate.
  if(error.nativeResult&&!error.cleanupBlocked){warn('Account names could not be read: '+error.message);return;}
  throw error;
 });
 const counts=new Map();for(const {name} of names.values())counts.set(name,(counts.get(name)||0)+1);
 return archives.map(a=>names.has(a.uid)?{...a,userName:names.get(a.uid).name,profileId:names.get(a.uid).profileId,
  duplicateName:counts.get(names.get(a.uid).name)>1}:a);
}
module.exports={decorate,nickname};
