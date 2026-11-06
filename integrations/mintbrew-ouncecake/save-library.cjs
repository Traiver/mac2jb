'use strict';
const {TextDecoder}=require('node:util'),{inflateRawSync}=require('node:zlib');
const {success,withCleanup,throwIfCancelled}=require('../../vendor/OunceCake/engine/protocol.cjs');
const clean=value=>String(value||'').replace(/[\x00-\x1f\x7f-\x9f\u2028-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,160);
function controlName(data){
 if(!Buffer.isBuffer(data)||data.length<0x4000)return;
 try{
  let titles=data.subarray(0,0x3000);
  if(data[0x3215]===1){const size=titles.readUInt16LE();if(size>0x2ffe)return;
   titles=inflateRawSync(titles.subarray(2,2+size),{maxOutputLength:32*0x300});}
  for(let at=0;at+0x200<=titles.length;at+=0x300){
   const bytes=titles.subarray(at,at+0x200),end=bytes.indexOf(0);
   const name=clean(new TextDecoder('utf-8',{fatal:true}).decode(end<0?bytes:bytes.subarray(0,end)));
   if(name)return name;
  }
 }catch{}
}
async function titleNames({attachment,archives,knownEntries=[],shouldStop=()=>false,onProgress=()=>{}}){
 const names=new Map(Object.entries(require('../../vendor/ns2-savekit/config/titles.json').names||{}));
 for(const entry of knownEntries)if((!entry.kind||entry.kind==='game')&&entry.name)names.set(entry.titleId,clean(entry.name));
 const missing=[...new Set(archives.map(a=>a.titleId))].filter(id=>!names.has(id));
 if(!missing.length)return names;
 const {s,domain,service}=attachment;let control;
 try{
  await withCleanup(async()=>{
   throwIfCancelled(shouldStop);let ns;
   try{ns=await service('ns:ro');}
   catch(error){if(!/0x615|service unavailable|service not found/i.test(error.message))throw error;ns=await service('ns:am2');}
   control=domain.oneHandle(success(await s.ipc('Open saved title name reader',ns,7989),'Open saved title name reader'));
   const address=s.base+0x10000,size=0x24000;
   for(const id of missing){
    throwIfCancelled(shouldStop);const input=Buffer.alloc(16);input[0]=1;input.writeBigUInt64LE(BigInt('0x'+id),8);
    await s.write(address,Buffer.alloc(size));
    const reply=await s.ipc('Read saved title name',control,0,input,{receive:[{address,size,mode:0}]});
    if(reply.result)continue;
    const name=controlName(await s.readOwned(address,0x4000));if(name)names.set(id,name);
   }
  },async()=>{if(control)await s.close(control);});
 }catch(error){
  if(error.cleanupBlocked||error instanceof AggregateError||(!error.nativeResult&&!/Service unavailable: ns:|SM could not open ns:/.test(error.message)))throw error;
  onProgress('OunceCake: Some saved title names are unavailable; their TitleIDs remain selectable.');
 }
 return names;
}
function groups(archives){
 const byTitle=new Map();
 for(const archive of archives){
  if(!byTitle.has(archive.titleId))byTitle.set(archive.titleId,{titleId:archive.titleId,name:archive.titleName||'Unknown title',archives:[]});
  byTitle.get(archive.titleId).archives.push(archive);
 }
 return [...byTitle.values()].sort((a,b)=>a.name.localeCompare(b.name,'en',{sensitivity:'base'})||a.titleId.localeCompare(b.titleId));
}
function folderName(group){
 const bcat=group.archives.filter(a=>a.type===2).length;
 const tag=bcat?(bcat===group.archives.length?'[BCAT] ':'[Saves + BCAT] '):'';
 return '[Folder] '+tag+group.name+' ('+group.archives.length+')';
}
// Keep every archive reachable without changing the GPU's 1001-row buffer.
function page(rows,{page=0,parent='root',kind='library',prefix=[]}={}){
 const size=990,last=Math.max(0,Math.ceil(rows.length/size)-1),current=Math.min(Math.max(0,page),last);
 const output=[{name:'[..] Back',navigation:parent},...prefix];
 if(current>0)output.push({name:'[Previous page]',savePage:{kind,page:current-1}});
 output.push(...rows.slice(current*size,(current+1)*size));
 if(current<last)output.push({name:'[Next page]',savePage:{kind,page:current+1}});
 return {rows:output,page:current};
}
module.exports={titleNames,controlName,groups,folderName,page};
