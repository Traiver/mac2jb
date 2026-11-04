'use strict';
// mac2jb downstream: read-only system-title views and registered firmware NCA export.
const path = require('node:path');
const {TextDecoder} = require('node:util');
const contentDefault = require('./content.cjs');
const mountsDefault = require('./mounts.cjs');
const {createProgramMounts} = require('./program.cjs');
const {openProgramRomfsStorage, openDataIdStorage} = require('./firmware.cjs');
const {success, pathRequest, throwIfCancelled} = require('./protocol.cjs');
const FIRMWARE_ID = 'fffffffffffffff0';
const MAX_ENTRIES = 200000;
const MAX_INDEX_BYTES = 64 * 1024 * 1024;
const absentCode = new Set([0x7d202, 0x7d402, 0x408, 0x1408, 0x7d002]);
const check = (ok, reason) => {if (!ok) throw Error('System export: ' + reason);};
const sizeOf = n => {const v=Number(n);check(Number.isSafeInteger(v)&&v>=0,'invalid file/storage size');return v;};
const utf8 = new TextDecoder('utf-8', {fatal:true});

function latest(records, kind) {
  check(Array.isArray(records)&&records.length<=10000,'invalid system title inventory');
  const selected = new Map();
  for (const row of records) {
    check(row&&/^[0-9a-f]{16}$/.test(row.contentTitle)&&row.storage===3&&
      Number.isInteger(row.version)&&row.version>=0&&row.version<=0xffffffff,'invalid system title record');
    if (!selected.has(row.contentTitle)||selected.get(row.contentTitle).version<row.version) selected.set(row.contentTitle,row);
  }
  return [...selected.values()].sort((a,b)=>a.contentTitle.localeCompare(b.contentTitle)).map(row=>({
    title:row.contentTitle, name:(kind==='system-program'?'[SystemProgram] ':'[SystemData] ')+row.contentTitle+' v'+row.version,
    storages:[3], kind, version:row.version,
  }));
}
async function discoverExports({attachment, shouldStop=()=>false, content=contentDefault}) {
  const cancel=()=>throwIfCancelled(shouldStop);
  cancel();const games=await content.discoverGames({...attachment,shouldStop});cancel();
  if (!content.discoverSystemPrograms||!content.discoverSystemData) return games;
  const programs=latest(await content.discoverSystemPrograms({...attachment,shouldStop}), 'system-program');cancel();
  const data=latest(await content.discoverSystemData({...attachment,shouldStop}), 'system-data');cancel();
  const entries=[{title:FIRMWARE_ID,name:'[Firmware] All registered original NCAs',storages:[3],kind:'firmware-nca'},
    ...games,...programs,...data];
  check(entries.length<=1000,'too many titles for the display; catalog was not truncated');
  check(new Set(entries.map(row=>row.title)).size===entries.length,'duplicate title or reserved export ID');
  return entries;
}

async function walkFilesystem({attachment:a,handle,start='/',shouldStop=()=>false}) {
  const pending=[start],visited=new Set(),entries=[],paths=new Set();
  while(pending.length){
    throwIfCancelled(shouldStop);
    const directory=pending.pop();check(!visited.has(directory),'directory cycle');visited.add(directory);
    const mode=Buffer.alloc(4);mode.writeUInt32LE(3);
    const opened=success(await a.filesystem.pathMethod(a.s,handle,9,directory,mode),'Open system directory');
    const dir=a.domain.oneHandle(opened);
    try{
      for(;;){
        throwIfCancelled(shouldStop);
        const reply=success(await a.s.ipc('Read system directory',dir,0,Buffer.alloc(0),{
          receive:[{address:a.s.base+0x6000,size:32*0x310,mode:0}],
        }),'Read system directory');
        check(Buffer.isBuffer(reply.data)&&reply.data.length>=8,'short directory count');
        const count=sizeOf(reply.data.readBigUInt64LE());check(count<=32,'directory count exceeds owned buffer');
        if(!count)break;
        const bytes=await a.s.readOwned(a.s.base+0x6000,count*0x310);
        check(Buffer.isBuffer(bytes)&&bytes.length===count*0x310,'short directory data');
        for(let i=0;i<count;i++){
          const row=bytes.subarray(i*0x310,(i+1)*0x310),end=row.subarray(0,0x301).indexOf(0);
          check(end>0,'unterminated or empty directory name');
          const name=utf8.decode(row.subarray(0,end));
          check(name!=='.'&&name!=='..'&&!/[\\/\x00-\x1f\x7f]/.test(name),'unsafe directory name');
          check(row[0x304]===0||row[0x304]===1,'unknown directory entry type');
          const filename=directory.replace(/\/$/,'')+'/'+name;
          check(Buffer.byteLength(filename)<=0x300&&!paths.has(filename),'duplicate or oversized path');
          check(entries.length<MAX_ENTRIES,'directory inventory exceeded limit');paths.add(filename);
          const entry={path:filename,type:row[0x304]===1?'file':'directory',size:sizeOf(row.readBigUInt64LE(0x308))};
          entries.push(entry);if(entry.type==='directory')pending.push(filename);
        }
      }
    }finally{await a.s.close(dir);}
  }
  return entries;
}
function prepared(views,sources,info,mounts=mountsDefault){
  check(sources.length>0,'no readable sections were found');
  const index=mounts.buildIndex(views);check(index.length<=MAX_INDEX_BYTES,'index exceeds supported memory limit');
  return {index,sources,exportInfo:info};
}
async function prepareFirmwareNcas({attachment:a,shouldStop=()=>false,mounts=mountsDefault}) {
  throwIfCancelled(shouldStop);
  // IFileSystemProxy.OpenContentStorageFileSystem: content storage 0 = BuiltInSystem.
  const input=Buffer.alloc(4);input.writeUInt32LE(0);
  const handle=a.domain.oneHandle(success(await a.s.ipc('Open read-only system content filesystem',a.root,110,input),
    'Open system content filesystem'));
  const entries=await walkFilesystem({attachment:a,handle,start:'/registered',shouldStop});
  const files=entries.filter(row=>row.type==='file'&&/\.nca$/i.test(row.path));
  check(files.length>0,'no registered firmware NCA files were found');
  const names=new Set();
  const exported=files.map(row=>{
    const name=path.posix.basename(row.path);check(/^[a-f0-9]{32}(?:\.cnmt)?\.nca$/i.test(name),'unexpected NCA filename');
    check(!names.has(name.toLowerCase()),'duplicate firmware NCA filename');names.add(name.toLowerCase());
    return {...row,path:'/'+name,sourcePath:row.path};
  });
  return prepared([{path:'/firmware/nca',kind:'filesystem',mount:0,entries:exported}],
    [{handle,kind:1,size:0}],{kind:'firmware-nca',files:files.length,bytes:files.reduce((n,row)=>n+row.size,0)},mounts);
}
async function prepareSystemTitle({attachment:a,entry,shouldStop=()=>false,content=contentDefault,mounts=mountsDefault,
  programMounts=createProgramMounts,openProgramStorage=openProgramRomfsStorage,openDataStorage=openDataIdStorage}) {
  check(entry&&['system-program','system-data'].includes(entry.kind)&&/^[0-9a-f]{16}$/.test(entry.titleId)&&
    entry.storages?.length===1&&entry.storages[0]===3,'invalid system title selection');
  const cancel=()=>throwIfCancelled(shouldStop),data=entry.kind==='system-data';cancel();
  const source=await (data?content.resolveSystemDataContent:content.resolveProgramContent)({...a,title:entry.titleId,storage:3});
  check(source.storage===3&&(!Number.isInteger(entry.version)||source.version===entry.version),'system title changed since discovery');
  const prefix='/'+(data?'system-data':'system-programs')+'/'+entry.titleId,views=[],sources=[],absent=[];
  if(!data){
    cancel();const filename=Buffer.alloc(0x301);check(Buffer.byteLength(source.contentPath)<=0x300,'oversized content path');filename.write(source.contentPath);
    await a.s.write(a.s.base+0x2000,filename);
    const identity=success(await a.domain.send(a.s,'Read system NCA ProgramId',a.root,
      pathRequest(618,Buffer.from([source.attributes]),a.s.base+0x2000)),'Read system NCA ProgramId');
    check(Buffer.isBuffer(identity.data)&&identity.data.length>=8,'short ProgramId');
    const runtime=identity.data.readBigUInt64LE().toString(16).padStart(16,'0');
    let handle;
    try{handle=await programMounts(a).openCode({title:runtime,storage:3,attributes:source.attributes,source});}
    catch(error){if(!absentCode.has(error.nativeResult?.canonical))throw error;absent.push('exefs');}
    if(handle){
      const entries=await walkFilesystem({attachment:a,handle,shouldStop});
      views.push({path:prefix+'/exefs',kind:'filesystem',mount:sources.length,entries});sources.push({handle,kind:1,size:0});
    }
  }
  cancel();let storage;
  try{storage=await (data?openDataStorage(a,entry.titleId,3):openProgramStorage(a,source));}
  catch(error){if(error.nativeResult?.canonical!==0x7d202)throw error;absent.push('romfs');}
  if(storage){
    const size=sizeOf(storage.size),entries=await mounts.readRomfs((offset,length)=>{
      cancel();return a.filesystem.readStorage(a.s,storage.handle,offset,length);
    },size);
    views.push({path:prefix+'/romfs',kind:'storage',mount:sources.length,entries});sources.push({handle:storage.handle,kind:0,size});
  }
  cancel();return prepared(views,sources,{kind:entry.kind,title:entry.titleId,version:source.version,absentSections:absent},mounts);
}
function titleLabel(entry){
 check(entry&&/^[0-9a-f]{16}$/.test(entry.titleId),'invalid export title ID');
 const name=String(entry.titleName||entry.name||'Unknown title').normalize('NFC')
  .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'');
 let safe='';for(const char of name||'Unknown title'){if(Buffer.byteLength(safe+char)>200)break;safe+=char;}
 return safe.trim()+(entry.kind==='firmware-nca'?'':' ['+entry.titleId+']');
}
async function prepareExport(options){
 const {entry,mounts=mountsDefault}=options;
 const exportRoot=titleLabel(entry);
 const scoped={...options,exportRoot,mounts:{...mounts,buildIndex:views=>mounts.buildIndex(views,exportRoot)}};
 if(options.raw&&entry.kind!=='firmware-nca')return prepareTitleNcas(scoped);
 if(!entry.kind||entry.kind==='game')return mounts.prepareGame({...options,exportRoot,title:entry.titleId});
 if(entry.kind==='firmware-nca')return prepareFirmwareNcas(scoped);
 return prepareSystemTitle(scoped);
}
module.exports={titleLabel,FIRMWARE_ID,latest,discoverExports,walkFilesystem,prepareExport,prepareSystemTitle,prepareFirmwareNcas};

// Read the original encrypted title content from NCM; no ES or decryption call is made.
async function prepareTitleNcas({attachment:a,entry,shouldStop=()=>false,content=contentDefault,mounts=mountsDefault}){
 check(entry&&/^[0-9a-f]{16}$/.test(entry.titleId),'invalid raw title selection');
 const cancel=()=>throwIfCancelled(shouldStop),title=entry.titleId;
 const game=!entry.kind||entry.kind==='game';
 const records=[];
 if(game&&content.discoverBase){
  cancel();for(const row of await content.discoverBase({...a,title,shouldStop}))records.push({storages:[row.storage],base:row,contents:row.contents});
 }
 if(!records.length)records.push({storages:entry.storages||[4,5,2]});
 if(game){
  for(const [discover,key] of [['discoverUpdates','update'],['discoverDlc','dlc'],['discoverDataPatches','dataPatch']]){
   cancel();if(content[discover])for(const row of await content[discover]({...a,title,shouldStop}))records.push({storages:[row.storage],[key]:row,contents:row.contents});
  }
 }
 const resolved=new Map();
 for(const record of records)for(const storage of record.storages){
  const choices=record.contents?.length?record.contents:[1,2,3,4,5,6].map(contentType=>({contentType}));
  for(const choice of choices){
   cancel();
   try{
    // Original NCA export must never enter FS618, mount or ELicense preparation.
    const source=await content.resolveContent({...a,root:undefined,title,storage,contentType:choice.contentType,
      content:choice.contentId?choice:undefined,base:record.base,update:record.update,dlc:record.dlc,dataPatch:record.dataPatch});
    check(/^[0-9a-f]{32}$/.test(source.contentId),'invalid NCA content ID');
    if(!resolved.has(source.contentId))resolved.set(source.contentId,source);
   }catch(error){
    if(![0xe05,0x21005,0x20a05,0xa05].includes(error.nativeResult?.canonical))throw error;
   }
  }
 }
 check(resolved.size>0,'no original title NCAs were found');
 const sources=[],entries=[],stores=new Map(),contentStorages={3:0,4:1,5:2};
 for(const source of resolved.values()){
  cancel();const storage=contentStorages[source.storage];
  if(storage===undefined)throw Object.assign(Error('Raw NCA export is not supported for this storage (game cards are not supported).'),{code:'RAW_EXPORT_UNAVAILABLE'});
  if(!stores.has(storage)){
   const input=Buffer.alloc(4);input.writeUInt32LE(storage);
   const handle=a.domain.oneHandle(success(await a.s.ipc('Open read-only title content filesystem',a.root,110,input),'Open title content filesystem'));
   stores.set(storage,sources.length);sources.push({handle,kind:1,size:0});
  }
  const mount=stores.get(storage);
  check(typeof source.contentPath==='string'&&/^@[^:]+:\/\//.test(source.contentPath),'invalid NCA content path');
  const backing='/'+source.contentPath.replace(/^@[^:]+:\/\//,'');
  check(backing.startsWith('/registered/')&&Buffer.byteLength(backing)<=0x300&&!backing.split('/').some(x=>x==='.'||x==='..')&&!/[\\\x00-\x1f]/.test(backing),'unsafe NCA content path');
  const opened=success(await a.filesystem.openFile(a.s,sources[mount].handle,backing),'Open original NCA');
  let size;try{cancel();size=sizeOf(await a.filesystem.fileSize(a.s,opened.handle));cancel();}finally{await a.s.close(opened.handle);}
  entries.push({path:'/'+source.contentId+'.nca',type:'file',sourcePath:backing,size,mount});
 }
 cancel();
 const views=sources.map((source,mount)=>({path:'/raw/'+title,kind:'filesystem',mount,entries:entries.filter(row=>row.mount===mount)}));
 return prepared(views,sources,{kind:'game-nca',title,files:entries.length,original:true,decryptionAttempted:false},mounts);
}
module.exports.prepareTitleNcas=prepareTitleNcas;
