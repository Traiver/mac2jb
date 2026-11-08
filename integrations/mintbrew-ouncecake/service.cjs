const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const protocol=require('./protocol.cjs');
const catalog=require('./catalog.cjs');
const saveLibrary=require('./save-library.cjs');
const layout=require('../../vendor/MintBrew/sdk/host/layout.cjs');
const {runPreparation,canRawFallback,DEFAULT_TIMEOUT_MS}=require('../../vendor/OunceCake/engine/preparation.cjs');
const {titleLabel}=require('../../vendor/OunceCake/engine/exports.cjs');
const runFile=promisify(execFile);
const LARGE_INDEX_BYTES=8*1024*1024;
const check=(value,message)=>{if(!value)throw Error(message);};
const blocked=error=>Boolean(error?.cleanupBlocked||error?.errors?.some(blocked));
const recoverableContentError=error=>!blocked(error)&&!(error instanceof AggregateError)&&
 error?.code!=='FTP_CANCELLED'&&Boolean(error?.nativeResult||canRawFallback(error)||
  ['PREPARATION_TIMEOUT','RAW_EXPORT_UNAVAILABLE','EXPORT_PART_EMPTY','COMPACTED_BASE'].includes(error?.code)||
  (error?.code==='HTTP_SERVER_ALLOCATION_FAILED'&&error.retrySafe===true)||
  /^(Invalid RomFS:|Invalid server index:|Could not prepare |No installed base Program content was found|Content requires an original-content mount)/.test(error?.message||''));

function ipv4(data){
 check(Buffer.isBuffer(data)&&data.length>=layout.FIELD.network+24,
  'Switch network status was truncated');
 check(data.readUInt32LE(layout.FIELD.magic)===layout.MAGIC&&
  data.readUInt32LE(layout.FIELD.version)===layout.VERSION&&
  (data.readUInt32LE(layout.FIELD.flags)&layout.FLAGS.network)!==0&&
  data.readUInt32LE(layout.FIELD.network)===0,
  'The Switch does not have a ready IPv4 connection');
 const address=[...data.subarray(layout.FIELD.network+20,layout.FIELD.network+24)].join('.');
 check(net.isIPv4(address)&&!address.startsWith('127.')&&
  !address.startsWith('0.')&&Number(address.split('.')[0])<224,
  'The Switch reported an unusable IPv4 address');
 return address;
}

function create({rpc,menu,gpu,app,directory,root,runDirectory,sourceSession,
 onProgress=()=>{},onFatal=()=>{},onGameList=async()=>{},modules,verifyHeld,rasterGames,liveCheck,saveImporter=require('./save-import.cjs'),saveTools=require('./saves.cjs'),saveServer=require('./save-server.cjs'),preparationTimeoutMs=DEFAULT_TIMEOUT_MS}={}){
 check(rpc&&menu&&gpu&&app&&typeof directory==='string'&&typeof root==='string'&&
  typeof runDirectory==='string'&&typeof sourceSession==='string',
  'OunceCake requires the held MintBrew session');
 check(app.id==='ouncecake'&&app.manifest?.service==='ouncecake-v1'&&
  app.fingerprint===gpu.fingerprint&&gpu.privateStorage?.bytes===protocol.STORAGE_BYTES&&
  Number.isSafeInteger(gpu.privateStorage.mapped)&&gpu.privateStorage.mapped>0,
  'OunceCake app identity or private storage differs');
 const mapped=gpu.privateStorage.mapped;
 const vendor=path.join(root,'vendor/OunceCake');
 const engine=modules||{
  session:require(path.join(vendor,'engine/session.cjs')),
  content:require(path.join(vendor,'engine/content.cjs')),
  mounts:require(path.join(vendor,'engine/mounts.cjs')),
  server:require(path.join(vendor,'engine/server.cjs')),
  exports:require(path.join(vendor,'engine/exports.cjs')),
 };
 let started=false,stopping=false,selected=false,status=protocol.STATES.reading;
 let task,attachment,server,run,games=[],failure,closing,nativeImage,baselineHandles;
 let allEntries=[],catalogs,view='root',generation=0,focus=0,partTitle,saveTitle,titleVisible=false;
 let libraryArchives=[],libraryGroups=[],libraryPage=0,archiveRows=[],saveParent='root';
 let importRequest;
 const importFiles=require('./save-import-files.cjs');
 const largeTitles=new Set();
 const report={session:rpc.a.session,sourceSession,started:new Date().toISOString(),status:'reading',
  resourcesRetained:true};
 const save=()=>fs.writeFile(path.join(directory,'mintbrew-ouncecake.json'),
  JSON.stringify(report,null,2)+'\n',{mode:0o600});
 const publish=async(state,message='',count=games.length,notice='')=>{
  status=state;report.status=Object.keys(protocol.STATES).find(key=>protocol.STATES[key]===state);
  await rpc.write(mapped,protocol.header(state,count,message,generation,view!=='root',focus,titleVisible&&(state!==protocol.STATES.catalog||['parts','saves','save-games'].includes(view)),['saves','save-games'].includes(view)?2:view==='root'||view==='parts'?1:0,notice));await save();
 };
 const live=liveCheck||(async()=>{
  try{
   const current=JSON.parse(await fs.readFile(path.join(runDirectory,'result.json'),'utf8'));
   return current.verified===true&&!current.error&&current.rpc?.mode==='held'&&
    current.rpc?.state==='listening'&&current.fs?.verified===true&&
    current.fs?.restored===true&&current.fs?.retainedEndpoint?.ready===true;
  }catch{return false;}
 });
 const fail=async(error)=>{
  if(server&&!await live())error.cleanupBlocked=true;
  if(error.allocation)report.allocationFailure=error.allocation;
  failure ||= error;report.error=error.message;report.cleanupBlocked ||= blocked(error);
  if(!report.cleanupBlocked){
   try{await publish(protocol.STATES.error,error.message);}catch(writeError){failure=writeError;report.cleanupBlocked=true;}
  }
  onProgress('OunceCake: '+error.message);
  if(report.cleanupBlocked)onFatal(failure);
  await save().catch(()=>{});
 };
 const track=operation=>{
  task=operation.catch(async error=>{
   try{await fail(error);}catch(handlerError){
    handlerError.cleanupBlocked=true;failure=handlerError;report.cleanupBlocked=true;
    try{onFatal(handlerError);}catch{}await save().catch(()=>{});
   }
  });
 };
 async function resumeTitleFtp(){
  if(stopping)return;
  try{await onGameList();}catch(error){onProgress('MintFTP: '+error.message);}
 }
 async function stopServer(){
  if(server){
   try{
    if(server.kind!=='local-save')check(await live(),'OunceCake lost its held session before HTTP/WebDAV shutdown');
    const proof=await server.close();
    check(server.kind==='local-save'?proof?.localStopped===true&&proof?.connectionsClosed===true:
     proof?.nativeStopped===true&&proof?.joined===true&&proof?.mappingsCleared===true,
     'OunceCake could not prove native HTTP/WebDAV shutdown');
    (report.shutdowns ||= []).push(proof);server=null;
   }catch(error){error.cleanupBlocked=true;report.cleanupBlocked=true;failure=error;await save();throw error;}
  }
 }
 async function releaseSelectedHandles(){
  check(attachment&&baselineHandles,'OunceCake game attachment is unavailable');
  try{
   check(!server||server.kind==='local-save','OunceCake native HTTP/WebDAV must stop before game handles close');
   check(attachment.s.threads.size===0,'OunceCake game worker did not stop');
   for(const handle of [...attachment.s.handles].reverse()){
    if(!baselineHandles.has(handle))await attachment.s.close(handle);
   }
   check([...attachment.s.handles].every(handle=>baselineHandles.has(handle)),
    'OunceCake selected-game handles remain open');
  }catch(error){error.cleanupBlocked=true;report.cleanupBlocked=true;failure=error;await save();throw error;}
 }
 async function releaseGameOwned(){
  await stopServer();
  await releaseSelectedHandles();
 }
 async function releaseOwned(){
  await stopServer();
  if(attachment){
   try{
    await attachment.close();
    check(attachment.s.base===0&&attachment.s.handles.size===0&&attachment.s.threads.size===0,
     'OunceCake attachment cleanup was deferred');
    attachment=null;
   }catch(error){error.cleanupBlocked=true;report.cleanupBlocked=true;failure=error;await save();throw error;}
  }
 }
 async function verify(){
  if(verifyHeld){const result=await verifyHeld();run=result.run;
   check(run?.proof?.session===sourceSession&&run?.connection?.addresses?.session===sourceSession,
    'OunceCake test session identity changed');return result.snapshot;}
  const expected=path.join(root,'vendor/MintBrew/apps/ouncecake');
  check(await fs.realpath(app.root)===await fs.realpath(expected),
   'OunceCake service cannot run from a custom app folder');
  require('./prepare.cjs').verifyMintBrew(root,path.join(root,'vendor/MintBrew'));
  const snapshot=await require(path.join(root,'scripts/gui-ouncecake.cjs')).verifySnapshot(root);
  const validate=require(path.join(root,'scripts/gui-homebrew.cjs')).validateRun;
  run=await validate(root,runDirectory,require(path.join(root,'scripts/gui-dump.cjs')).verifiedSession);
  check(run.proof.session===sourceSession&&run.connection.addresses.session===sourceSession,
   'OunceCake held session identity changed');
  await require(path.join(root,'scripts/gui-ouncecake.cjs')).validateAttachment(run);
  check(await live(),'OunceCake requires a live held RPC session');
  return snapshot;
 }
 async function rasterRows(next){
  let image;
  if(rasterGames)image=await rasterGames(next);
  else{
   const temporary=await fs.mkdtemp(path.join(directory,'ouncecake-catalog-'));
   try{
    const input=path.join(temporary,'games.json'),output=path.join(temporary,'games.bin');
    await fs.writeFile(input,JSON.stringify(next),{flag:'wx',mode:0o600});
    await runFile('python3',[path.join(__dirname,'raster.py'),input,output],{timeout:60000,maxBuffer:65536});
    image=await fs.readFile(output);
   }finally{await fs.rm(temporary,{recursive:true,force:true});}
  }
  return image;
 }
 async function renderTitle(entry){
  const image=await rasterRows([{name:entry.titleName||entry.name,titleId:entry.titleId,kind:entry.kind,heading:true}]);
  check(image.length===protocol.TILE_BYTES,'Invalid title raster size');
  await rpc.write(mapped+protocol.HEADER_BYTES+protocol.TITLE_TILE_INDEX*protocol.TILE_BYTES,image);
  titleVisible=true;
 }
 async function showCatalog(nextView,nextFocus=0){
  if(!['parts','saves','save-games'].includes(nextView))titleVisible=false;
  const next=catalogs[nextView];check(next&&next.length>0&&next.length<=protocol.MAX_GAMES,'OunceCake catalog exceeds its display capacity');
  await publish(protocol.STATES.reading,nextView==='system'?'Opening System Files...':'Opening main list...');
  const image=await rasterRows(next);
  check(image.length===next.length*protocol.TILE_BYTES&&protocol.HEADER_BYTES+image.length<=protocol.STORAGE_BYTES,'OunceCake catalog raster size differs');
  if(stopping)return;
  await rpc.write(mapped+protocol.HEADER_BYTES,image);
  if(stopping)return;
  games=next;view=nextView;generation=(generation+1)>>>0;focus=Math.min(nextFocus,next.length-1);
  report.catalogView=view;report.visibleEntries=games.length;report.totalTitles=allEntries.length;
  report.systemTitles=catalogs.system.length-1;
  report.games=allEntries.filter(entry=>!entry.kind||entry.kind==='game').length;
  report.imageSha256=require('node:crypto').createHash('sha256').update(image).digest('hex');
  await publish(protocol.STATES.catalog,'',games.length);
 }
 async function showParts(entry){
  await renderTitle(entry);
  partTitle=entry.titleId;largeTitles.add(partTitle);
  await fs.writeFile(path.join(directory,'ouncecake-large-titles.json'),JSON.stringify([...largeTitles]),{mode:0o600});
  catalogs.parts=catalog.parts(entry);
  await showCatalog('parts',1);
  await publish(protocol.STATES.catalog,'',games.length);
 }
 async function discover(){
  const snapshot=await verify();nativeImage=snapshot.image;
  if(stopping)return;
  attachment=await engine.session.attachGame(run.directory);
  check(attachment.live.session===sourceSession,'OunceCake attached to another session');
  if(stopping)return;
  onProgress('OunceCake: reading installed games and system titles');
  allEntries=require(path.join(root,'scripts/gui-ouncecake.cjs')).catalogEntries(
   await (engine.exports?engine.exports.discoverExports({attachment,content:engine.content,shouldStop:()=>stopping}):engine.content.discoverGames({...attachment,shouldStop:()=>stopping})));
  if(stopping)return;
  try{const ids=JSON.parse(await fs.readFile(path.join(directory,'ouncecake-large-titles.json'),'utf8'));check(Array.isArray(ids)&&ids.length<=1000&&ids.every(id=>/^[0-9a-f]{16}$/.test(id)),'Invalid large-title inventory');for(const id of ids)largeTitles.add(id);}catch(error){if(error.code!=='ENOENT')throw error;}
  catalogs=catalog.views(allEntries);
  check(attachment.s.threads.size===0,'OunceCake discovery left a native worker running');
  baselineHandles=new Set(attachment.s.handles);
  if(stopping)return;
  await showCatalog('root');
  onProgress('OunceCake: choose a game, System Files, or firmware export');
  report.nativeImageSha256=snapshot.nativeImageSha256;await save();
 }
 function start(){
  check(!started&&!stopping,'OunceCake has already started');started=true;
  track(discover());
  return Promise.resolve();
 }
 async function saveOperation(operation){
  try{await operation();}
  catch(error){
   if(blocked(error))throw error;
   await stopServer();
   await releaseSelectedHandles();
   if(stopping)return;
   selected=false;report.error=error.message;report.titleId=null;
   await publish(protocol.STATES.catalog,error.message);onProgress('OunceCake: '+error.message);
   await resumeTitleFtp();
  }
 }
 async function selectSaves(index){
  if(started&&!stopping&&[protocol.STATES.reading,protocol.STATES.catalog].includes(status))await task;
  check(started&&!stopping&&!selected&&status===protocol.STATES.catalog&&Number.isInteger(index)&&index>=0&&index<games.length,'OunceCake save selection is unavailable');
  const entry=games[index];
  if(entry.saveLibrary)return openSaveLibrary();
  if(entry.navigation||entry.saveArchive||entry.saveGroup||entry.saveBatch||entry.savePage||entry.kind&&entry.kind!=='game'){
   await publish(protocol.STATES.catalog,'Select a game, then press Y for save data.');return;
  }
  selected=true;saveTitle=entry.titleId;const previous=task;
  track((async()=>{await previous;if(stopping)return;
   await saveOperation(async()=>{
    await renderTitle(entry);await publish(protocol.STATES.preparing,'Reading save archives. The game must be closed.');
    check(await live(),'The held RPC session ended before save enumeration');
    const archives=await runPreparation(async shouldStop=>saveTools.withProfiles({attachment,
     archives:await saveTools.inventory({attachment,titleId:entry.titleId,shouldStop}),shouldStop,onProgress}),
     {timeoutMs:preparationTimeoutMs,shouldStop:()=>stopping,onProgress});
    await releaseSelectedHandles();if(stopping)return;
    if(!archives.length){selected=false;await publish(protocol.STATES.catalog,'No save archives found for this game.');return;}
    saveParent='root';await showSaveArchives(archives,entry.titleName||entry.name,entry.titleId);selected=false;
   });
  })());
 }
 async function showSaveArchives(archives,titleName,titleId,page=0){
  saveTitle=titleId;
  archiveRows=archives.map(archive=>({name:saveTools.label(archive),titleName,titleId,kind:'save-data',saveArchive:archive}));
  await renderTitle({name:titleName,titleId,kind:'game'});
  const next=saveLibrary.page(archiveRows,{page,parent:saveParent,kind:'archives'});catalogs.saves=next.rows;
  await showCatalog('saves',1);
 }
 async function showSaveLibrary(page=0){
  const rows=libraryGroups.map(group=>({name:saveLibrary.folderName(group),titleId:group.titleId,kind:'save-title-folder',saveGroup:group.titleId}));
  const prefix=libraryArchives.length?[{name:'Export All Saves ('+libraryArchives.length+' archives)',saveBatch:true,titleName:'All Saves',kind:'save-data'}]:[];
  const next=saveLibrary.page(rows,{page,parent:'root',kind:'library',prefix});libraryPage=next.page;catalogs['save-games']=next.rows;
  await renderTitle({name:'Save Games',kind:'save-data'});await showCatalog('save-games',1);
 }
 async function openSaveLibrary(){
  selected=true;const previous=task;
  track((async()=>{await previous;if(stopping)return;
   await saveOperation(async()=>{
    await renderTitle({name:'Save Games',kind:'save-data'});await publish(protocol.STATES.preparing,'Reading all console saves, including uninstalled games...');
    check(await live(),'The held RPC session ended before save enumeration');
    libraryArchives=await runPreparation(async shouldStop=>{
     const archives=await saveTools.withProfiles({attachment,archives:await saveTools.inventory({attachment,shouldStop}),shouldStop,onProgress});
     const names=await saveTools.titleNames({attachment,archives,knownEntries:allEntries,shouldStop,onProgress});
     return archives.map(a=>({...a,titleName:names.get(a.titleId)||'Unknown title'}));
    },{timeoutMs:preparationTimeoutMs,shouldStop:()=>stopping,onProgress});
    await releaseSelectedHandles();if(stopping)return;
    libraryGroups=saveLibrary.groups(libraryArchives);
    report.saveLibrary={archives:libraryArchives.length,titles:libraryGroups.length};
    await showSaveLibrary();selected=false;
    if(!libraryArchives.length)await publish(protocol.STATES.catalog,'No game save archives were found.');
   });
  })());
 }
 async function exportSave(entry){
  const batch=Boolean(entry.saveBatch);
  selected=true;report.titleId=entry.titleId||null;report.exportKind=batch?'save-collection':'save-data';delete report.error;
  const previous=task;
  track((async()=>{await previous;if(stopping)return;
   await saveOperation(async()=>{
    await renderTitle(entry);await publish(protocol.STATES.preparing,'Backing up save data. Keep the game closed.');
    check(await live(),'The held RPC session ended before save backup');
    const address=saveServer.hostAddress(ipv4(await rpc.read(menu.controls.mapped+layout.OFFSET,layout.FIELD.network+24)));
    const backup=await runPreparation(shouldStop=>batch?saveTools.snapshotAll({attachment,archives:libraryArchives,
     directory:path.join(directory,'save-backups'),shouldStop,onProgress}):saveTools.snapshot({attachment,archive:entry.saveArchive,
     directory:path.join(directory,'save-backups'),shouldStop,onProgress}),
     {timeoutMs:batch?Math.max(preparationTimeoutMs,3600000):preparationTimeoutMs,shouldStop:()=>stopping,onProgress});
    await releaseSelectedHandles();
    report.saveBackup={folder:backup.folder,files:backup.manifest.files,bytes:backup.manifest.bytes,titleName:entry.titleName||entry.name,
     ...(batch?{archives:backup.manifest.archives.length,partial:backup.manifest.partial,failed:backup.manifest.failed}:{selection:entry.saveArchive})};
    await save();onProgress('OunceCake: Verified save backup: '+backup.folder);
    if(stopping)return;
    const name=batch?(backup.manifest.partial?'All Saves (partial)':'All Saves'):titleLabel(entry);
    let uploadDirectory;
    if(!batch){
     try{importFiles.supported(entry.saveArchive);uploadDirectory=path.join(directory,'save-imports');}catch{/* Export-only archive. */}
    }
    if(uploadDirectory)await fs.mkdir(uploadDirectory,{recursive:true,mode:0o700});
    server=await saveServer.start({...backup,name,address,uploadDirectory});report.httpURL=server.url;
    if(server.combined)await showTransfer('Drag edited files to Import/. Close the game before pressing A.');
    else await publish(protocol.STATES.running,(backup.manifest.partial?'PARTIAL ':'')+server.url);
    onProgress('OunceCake: Save transfer (Mac): '+server.url);
   });
  })());
 }
 async function requestImport(entry){
  selected=true;const previous=task;
  track((async()=>{await previous;if(stopping)return;
   await saveOperation(async()=>{
    importFiles.supported(entry.saveArchive);
    await publish(protocol.STATES.preparing,'Checking the selected save archive for import...');
    check(await live(),'The held RPC session ended before import preparation');
    const current=await saveTools.inventory({attachment,titleId:entry.saveArchive.titleId,shouldStop:()=>stopping});
    check(current.some(a=>require('./saves.cjs').identity(a)===require('./saves.cjs').identity(entry.saveArchive)),'Selected save archive is no longer installed');
    await releaseSelectedHandles();if(stopping)return;
    importRequest=await importFiles.create({directory:path.join(directory,'save-imports'),archive:entry.saveArchive,
     titleName:entry.titleName||entry.name,sourceSession});
    report.saveImport={phase:'waiting',request:importRequest.folder,selection:entry.saveArchive};
    await importFiles.atomic(path.join(importRequest.folder,'result.json'),{phase:'waiting'});
    await publish(protocol.STATES.importing,'Choose and confirm a save backup in mac2jb on your Mac. B: Cancel');
    notifyImport(importRequest);
   });
  })());
 }
 async function cancelImport(message='Save import cancelled.'){
  const pending=importRequest;importRequest=null;
  if(pending){await importFiles.atomic(path.join(pending.folder,'result.json'),{phase:'cancelled',message});
   // Invalidate even a delayed Mac confirmation without touching console data.
   await fs.rm(path.join(pending.folder,'request.json'),{force:true});}
  selected=false;if(!stopping){await publish(protocol.STATES.catalog,message);await resumeTitleFtp();}
 }
 function notifyImport(pending){
  onProgress('MAC2JB_OUNCECAKE_IMPORT '+JSON.stringify({requestFolder:pending.folder,nonce:pending.request.nonce}));
 }
 function showTransfer(message){
  return publish(protocol.STATES.saveTransfer,server.url,games.length,message);
 }
 async function submitWebImport(){
  await task;
  if(stopping||status!==protocol.STATES.saveTransfer)return;
  let source;
  try{source=server.freezeUpload();}
  catch(error){await showTransfer(error.message);return;}
  await publish(protocol.STATES.preparing,'Checking the uploaded files on the Mac...');
  const previous=task;
  track((async()=>{await previous;
   let pending,plan;
   try{
    const archive=report.saveBackup.selection;
    pending=await importFiles.create({directory:path.join(directory,'save-imports'),archive,
     titleName:report.saveBackup.titleName||archive.titleId,sourceSession,transport:'webdav'});
    plan=await importFiles.stage({folder:pending.folder,source});
    if(!stopping){
     report.saveImport={phase:'checking',request:pending.folder,selection:archive};
     await importFiles.atomic(path.join(pending.folder,'result.json'),{phase:'checking'});
     notifyImport(pending);
    }
   }catch(error){
    if(pending)await fs.rm(path.join(pending.folder,'request.json'),{force:true});
    if(!stopping){await server.resetUpload();await showTransfer(error.message);}
    return;
   }
   await performConfirmedImport(pending,plan.digest,{web:true});
  })());
 }
 async function pendingImport(){
  if(!importRequest||stopping||status!==protocol.STATES.importing)return false;
  if(Date.now()>=importRequest.request.expires)return true;
  return Boolean(await fs.lstat(path.join(importRequest.folder,'command.json')).catch(error=>{if(error.code!=='ENOENT')throw error;}));
 }
 async function consumeImport(){
  if(!await pendingImport())return;
  if(Date.now()>=importRequest.request.expires){await cancelImport('Save import request expired.');return;}
  const pending=importRequest;
  let command;
  try{
   command=await importFiles.json(path.join(pending.folder,'command.json'));
   check(command.nonce===pending.request.nonce&&['confirm','cancel'].includes(command.action),'Invalid save import confirmation');
   if(command.action==='cancel'){await cancelImport();return;}
   await importFiles.planAt(pending.folder,command.digest);
  }catch(error){await cancelImport(error.message);return;}
  importRequest=null;
  const previous=task;
  track((async()=>{await previous;await performConfirmedImport(pending,command.digest);})());
 }
 async function performConfirmedImport(pending,digest,{web=false}={}){
   if(stopping){
    await importFiles.atomic(path.join(pending.folder,'result.json'),{phase:'cancelled'});
    await fs.rm(path.join(pending.folder,'request.json'),{force:true});
    return;
   }
   await saveOperation(async()=>{
    let result;
    try{
     if(!await live()){
      await importFiles.atomic(path.join(pending.folder,'result.json'),{phase:'failed',message:'The held RPC session ended before save import.',writeMayHaveOccurred:false});
      throw Error('The held RPC session ended before save import');
     }
     await publish(protocol.STATES.preparing,'Importing save. Keep the game closed. Do not disconnect.');
     result=await saveImporter.restore({attachment,archive:pending.request.archive,
      folder:pending.folder,digest,confirmed:true,directory:path.join(root,'savekit-exports','ouncecake-import',path.basename(directory),pending.request.nonce),
      exportBackup:web?report.saveBackup.folder:undefined,saveTools,shouldStop:()=>stopping,onProgress,onState:async update=>{
       report.saveImport={...update,request:pending.folder};await save();
       await importFiles.atomic(path.join(pending.folder,'result.json'),update);
      }});
     await releaseSelectedHandles();
    }catch(error){
     await importFiles.atomic(path.join(pending.folder,'result.json'),{phase:'failed',message:error.message,
      backupPath:error.backupPath||report.saveImport?.backupPath,cleanupBlocked:blocked(error),
      writeMayHaveOccurred:report.saveImport?.writeMayHaveOccurred||['writing','verifying'].includes(report.saveImport?.phase)}).catch(()=>{});
     if(!web||blocked(error))throw error;
     await releaseSelectedHandles();
     if(!stopping){
      await server.resetUpload();
      await showTransfer(error.message);
      onProgress('OunceCake: '+error.message);
     }
     return;
    }finally{await fs.rm(path.join(pending.folder,'request.json'),{force:true});}
    onProgress('OunceCake: Save import verified. Original backup: '+result.backupPath);
    if(stopping)return;
    if(web){
     try{
      const manifest=await importFiles.json(path.join(result.verifiedPath,'manifest.json'));
      await server.resetUpload({folder:result.verifiedPath,manifest});
      Object.assign(report.saveBackup,{folder:result.verifiedPath,files:manifest.files,bytes:manifest.bytes});
     }catch(error){
      onProgress('OunceCake: Could not refresh the verified download: '+error.message);
      throw Error('Import verified. Reopen the save session to refresh Export.',{cause:error});
     }
     await showTransfer('Import verified. Refresh Export/ in WinSCP for the updated save.');
    }else{
     selected=false;
     await publish(protocol.STATES.catalog,'Save imported and verified. Automatic backup kept on the Mac.');
     await resumeTitleFtp();
    }
   });
 }
 async function select(index,{raw=false}={}){
  // Reuse the launcher mailbox for buttons on the single-save transfer screens.
  if(status===protocol.STATES.saveTransfer)return !raw&&index===0?submitWebImport():undefined;
  if(selected&&status===protocol.STATES.preparing)return;
  // Catalog rendering publishes before its final local bookkeeping settles.
  // Serialize the next controller request with that operation as well.
  if(started&&!stopping&&[protocol.STATES.reading,protocol.STATES.catalog].includes(status))await task;
  check(started&&!stopping&&!selected&&status===protocol.STATES.catalog&&
   Number.isInteger(index)&&index>=0&&index<games.length,
   'OunceCake game selection is unavailable');
  const chosen=games[index];
  if(chosen.saveLibrary)return openSaveLibrary();
  if(chosen.saveBatch)return raw?publish(protocol.STATES.catalog,'Choose one game and save archive for import.'):exportSave(chosen);
  if(chosen.saveGroup||chosen.savePage){
   selected=true;const previous=task;track((async()=>{await previous;if(stopping)return;
    if(chosen.saveGroup){const group=libraryGroups.find(g=>g.titleId===chosen.saveGroup);check(group,'Saved game folder is unavailable');saveParent='save-games';await showSaveArchives(group.archives,group.name,group.titleId);}
    else if(chosen.savePage.kind==='library')await showSaveLibrary(chosen.savePage.page);
    else{const next=saveLibrary.page(archiveRows,{page:chosen.savePage.page,parent:saveParent,kind:'archives'});catalogs.saves=next.rows;await showCatalog('saves',1);}
    selected=false;
   })());return;
  }
  if(chosen.navigation){
   selected=true;const previous=task;
   track((async()=>{
    await previous;if(stopping)return;
    const target=chosen.navigation;
    const returnFocus=target==='root'?Math.max(0,catalogs.root.findIndex(entry=>view==='save-games'?entry.saveLibrary:view==='saves'?entry.titleId===saveTitle:view==='parts'?entry.titleId===partTitle:entry.navigation==='system')):
     target==='save-games'?Math.max(0,catalogs['save-games'].findIndex(entry=>entry.saveGroup===saveTitle)):1;
    await showCatalog(target,returnFocus);selected=false;
   })());
   return;
  }
  if(chosen.saveArchive)return raw?requestImport(chosen):exportSave(chosen);
  if(!raw&&!chosen.exportPart&&largeTitles.has(chosen.titleId)){
   selected=true;const previous=task;track((async()=>{await previous;if(stopping)return;await showParts(chosen);selected=false;})());return;
  }
  selected=true;report.titleId=games[index].titleId;report.exportKind=games[index].kind||'game';delete report.error;delete report.romfsDiagnostic;delete report.rawFallbackReason;delete report.rawFallbackCode;delete report.exportInfo;delete report.allocationFailure;
  const selectedTitle=games[index].titleName||games[index].name;
  await renderTitle(games[index]);
  await publish(protocol.STATES.preparing,'Preparing export'+(games[index].kind==='firmware-nca'?'':' ['+games[index].titleId+']'));
  onProgress('OunceCake: Exporting '+selectedTitle+' ['+games[index].titleId+']'+(games[index].exportPart?' - '+games[index].name:''));
  const previous=task;
  track((async()=>{
   await previous;
   if(stopping)return;
   check(await live(),'The held RPC session ended before game preparation');
   const network=await rpc.read(menu.controls.mapped+layout.OFFSET,
    layout.FIELD.network+24);
   const address=ipv4(network);
   check(Buffer.isBuffer(nativeImage)&&nativeImage.length>0,'OunceCake native image is unavailable');
   check(attachment&&baselineHandles,'OunceCake game attachment is unavailable');
   if(stopping)return;
   const entry=games[index];
   const prepare=rawMode=>runPreparation(shouldStop=>engine.exports?
    engine.exports.prepareExport({attachment,entry,part:rawMode?undefined:entry.exportPart,raw:rawMode,mounts:engine.mounts,content:engine.content,shouldStop}):
    engine.mounts.prepareGame({attachment,title:entry.titleId,shouldStop}),
    {timeoutMs:preparationTimeoutMs,shouldStop:()=>stopping,onProgress});
   async function recover(error){
    if(stopping&&error.code==='FTP_CANCELLED'){
     if(server||!attachment||attachment.s.threads.size!==0){
      const unsafe=Error('OunceCake cancellation left a native worker active');unsafe.cleanupBlocked=true;throw unsafe;
     }
     return;
    }
    if(recoverableContentError(error)&&!server&&attachment&&attachment.s.threads.size===0){
     await releaseSelectedHandles();
     if(stopping)return;
     selected=false;report.titleId=null;report.error=error.message;
     if(error.exportInfo)report.exportInfo=error.exportInfo;
     if(error.codeFsDiagnostic)onProgress('OunceCake Base CodeFS diagnostics: '+JSON.stringify(error.codeFsDiagnostic));
     if(error.romfsDiagnostic){
      report.romfsDiagnostic={...error.romfsDiagnostic,titleId:entry.titleId};
      onProgress('OunceCake RomFS diagnostics: '+JSON.stringify(report.romfsDiagnostic));
     }
     if(error.code==='COMPACTED_BASE'&&!raw&&!entry.exportPart){
      report.splitReason='COMPACTED_BASE';
      await showParts(entry);
      await publish(protocol.STATES.catalog,error.message,games.length);
      await resumeTitleFtp();onProgress('OunceCake: '+error.message);return;
     }
     if(!raw&&!entry.exportPart&&(!entry.kind||entry.kind==='game')&&
       error.code==='ROMFS_HEADER_INVALID'&&error.romfsDiagnostic?.zeroHeader===true&&
       error.romfsDiagnostic.contentType===1&&error.romfsDiagnostic.view?.startsWith('/base/')){
      report.splitReason='ZERO_BASE_ROMFS_HEADER';
      await showParts(entry);
      await publish(protocol.STATES.catalog,'Base RomFS header is zero. Try Update or X for raw NCAs.',games.length);
      await resumeTitleFtp();onProgress('OunceCake: Base RomFS header is zero; select Update separately, or X for original NCAs.');return;
     }
     const message=error.code==='PREPARATION_TIMEOUT'?'Preparation timed out. X: raw NCAs; or choose another title.':
      error.exportInfo?.baseCompacted&&entry.exportPart==='base'?'Compacted Base is not readable alone. Choose Update or X for raw NCAs.':
      error.romfsDiagnostic?'RomFS unavailable. X: raw NCAs; or choose another title.':error.message;
     await publish(protocol.STATES.catalog,message,games.length);
     await resumeTitleFtp();onProgress('OunceCake: '+error.message);return;
    }
    error.cleanupBlocked=true;throw error;
   }
   let prepared;
   try{prepared=await prepare(raw);}
   catch(error){
    if(!raw&&canRawFallback(error)&&engine.exports?.prepareTitleNcas&&!server&&attachment.s.threads.size===0&&!stopping){
     // The failed operation has settled. Prove partial-view cleanup before opening raw storage.
     await releaseSelectedHandles();
     raw=true;report.rawFallbackReason=error.message;
     let reason=error;while(reason.cause)reason=reason.cause;
     report.rawFallbackCode=reason.code||null;
     onProgress('OunceCake: Raw NCA fallback: '+JSON.stringify({titleId:entry.titleId,code:reason.code||null,message:error.message,source:reason.source||error.source||null}));
     const message=reason.code==='GAME_ORIGINAL_CONTENT_REQUIRED'
      ?'Original-content mount required. Preparing original encrypted NCAs.'
      :reason.code==='MISSING_ELICENSE'?'No installed ELicense. Preparing original encrypted NCAs.'
      :reason.code==='ELICENSE_UNUSABLE'?'Installed ELicense not usable. Preparing original encrypted NCAs.'
      :'Content rights preparation failed. Preparing original encrypted NCAs.';
     await publish(protocol.STATES.preparing,message);
     try{prepared=await prepare(true);}catch(rawError){await recover(rawError);return;}
    }else{await recover(error);return;}
   }
   if(!raw&&!entry.exportPart&&(!entry.kind||entry.kind==='game')&&prepared.index.length>LARGE_INDEX_BYTES){
    await releaseSelectedHandles();if(stopping)return;
    await showParts(entry);selected=false;report.titleId=null;await resumeTitleFtp();return;
   }
   report.exportInfo=prepared.exportInfo||null;
   if(prepared.exportInfo?.partial){
    onProgress('OunceCake: Partial export: '+JSON.stringify(prepared.exportInfo.sections));
   }
   if(raw)report.exportKind=prepared.exportInfo?.kind||'game-nca';
   if(stopping)return;
   check(await live(),'The held RPC session ended before HTTP/WebDAV deployment');
   try{server=await engine.server.deployServer({attachment,image:nativeImage,...prepared,port:8080});}
   catch(error){
    if(error.allocation)report.allocationFailure=error.allocation;
    if(error.code==='HTTP_SERVER_ALLOCATION_FAILED'&&error.retrySafe===true&&!blocked(error)){
     if(!raw&&!entry.exportPart&&(!entry.kind||entry.kind==='game')){await releaseSelectedHandles();if(stopping)return;await showParts(entry);selected=false;report.titleId=null;await resumeTitleFtp();return;}
     await recover(error);return;
    }
    throw error;
   }
   if(stopping)return;
   check(await live(),'The held RPC session ended during HTTP/WebDAV startup');
   report.httpURL='http://'+address+':8080/';
   await publish(protocol.STATES.running,(raw?'RAW HTTP://':prepared.exportInfo?.partial?'PARTIAL HTTP://':prepared.exportInfo?.merged?'COMBINED HTTP://':'HTTP://')+address+':8080/');
   onProgress('OunceCake: '+report.httpURL);
  })());
 }
 async function back(){
  if(started&&!stopping&&[protocol.STATES.reading,protocol.STATES.catalog].includes(status))await task;
  // A B request from the waiting screen may arrive just after confirmation.
  // Once writing is queued, ignore it and let commit/readback settle.
  if(selected&&(status===protocol.STATES.preparing||status===protocol.STATES.importing&&!importRequest))return;
  if(importRequest&&status===protocol.STATES.importing)return cancelImport();
  if(started&&!stopping&&!selected&&status===protocol.STATES.catalog&&view!=='root')return select(0);
  check(started&&!stopping&&selected&&[protocol.STATES.running,protocol.STATES.saveTransfer].includes(status),
   'OunceCake HTTP/WebDAV is not running');
  await publish(protocol.STATES.closing,'Stopping the read-only HTTP/WebDAV worker...');
  const previous=task;
  track((async()=>{
   await previous;
   await releaseGameOwned();
   if(stopping)return;
   selected=false;report.titleId=null;report.httpURL=null;
   await publish(protocol.STATES.catalog,'',games.length);
   await resumeTitleFtp();
   onProgress('OunceCake: choose another export on the Switch');
  })());
 }
 function close(){
  if(closing)return closing;
  closing=(async()=>{
   stopping=true;
   await task;
   if(importRequest)await cancelImport();
   if(server?.kind==='local-save')await stopServer();
   if(report.cleanupBlocked)throw failure||Object.assign(Error('OunceCake native cleanup is uncertain'),{cleanupBlocked:true});
   await releaseOwned();
   report.status='stopped';report.completed=new Date().toISOString();await save();
  })();
  return closing;
 }
 // The existing launcher forwards bit 31 to selectRaw. Bit 30 selects saves,
 // allowing this app to update inside an already running MistBrew session.
 const selectRaw=index=>index>=0x40000000?selectSaves(index-0x40000000):select(index,{raw:true});
 return {start,select,selectRaw,selectSaves,back,close,pending:pendingImport,afterBatch:consumeImport,get report(){return {...report};}};
}
module.exports={create,ipv4};
