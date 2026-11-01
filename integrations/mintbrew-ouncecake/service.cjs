const fs=require('node:fs/promises');
const path=require('node:path');
const net=require('node:net');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const protocol=require('./protocol.cjs');
const catalog=require('./catalog.cjs');
const layout=require('../../vendor/MintBrew/sdk/host/layout.cjs');
const {runPreparation,canRawFallback}=require('../../vendor/OunceCake/engine/preparation.cjs');
const runFile=promisify(execFile);
const check=(value,message)=>{if(!value)throw Error(message);};
const blocked=error=>Boolean(error?.cleanupBlocked||error?.errors?.some(blocked));
const recoverableContentError=error=>!blocked(error)&&!(error instanceof AggregateError)&&
 error?.code!=='FTP_CANCELLED'&&Boolean(error?.nativeResult||canRawFallback(error)||
  ['PREPARATION_TIMEOUT','RAW_EXPORT_UNAVAILABLE'].includes(error?.code)||
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
 onProgress=()=>{},onFatal=()=>{},onGameList=async()=>{},modules,verifyHeld,rasterGames,liveCheck,preparationTimeoutMs=120000}={}){
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
 let allEntries=[],catalogs,view='root',generation=0,focus=0;
 const report={session:rpc.a.session,sourceSession,started:new Date().toISOString(),status:'reading',
  resourcesRetained:true};
 const save=()=>fs.writeFile(path.join(directory,'mintbrew-ouncecake.json'),
  JSON.stringify(report,null,2)+'\n',{mode:0o600});
 const publish=async(state,message='',count=games.length)=>{
  status=state;report.status=Object.keys(protocol.STATES).find(key=>protocol.STATES[key]===state);
  await rpc.write(mapped,protocol.header(state,count,message,generation,view==='system',focus));await save();
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
    check(await live(),'OunceCake lost its held session before HTTP/WebDAV shutdown');
    const proof=await server.close();
    check(proof?.nativeStopped===true&&proof?.joined===true&&proof?.mappingsCleared===true,
     'OunceCake could not prove native HTTP/WebDAV shutdown');
    (report.shutdowns ||= []).push(proof);server=null;
   }catch(error){error.cleanupBlocked=true;report.cleanupBlocked=true;failure=error;await save();throw error;}
  }
 }
 async function releaseSelectedHandles(){
  check(attachment&&baselineHandles,'OunceCake game attachment is unavailable');
  try{
   check(!server,'OunceCake HTTP/WebDAV must stop before game handles close');
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
 async function showCatalog(nextView,nextFocus=0){
  const next=catalogs[nextView];check(next&&next.length>0&&next.length<=protocol.MAX_GAMES,'OunceCake catalog exceeds its display capacity');
  await publish(protocol.STATES.reading,nextView==='system'?'Opening System Files...':'Opening main list...');
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
 async function select(index,{raw=false}={}){
  check(started&&!stopping&&!selected&&status===protocol.STATES.catalog&&
   Number.isInteger(index)&&index>=0&&index<games.length,
   'OunceCake game selection is unavailable');
  const chosen=games[index];
  if(chosen.navigation){
   selected=true;const previous=task;
   track((async()=>{
    await previous;if(stopping)return;
    const target=chosen.navigation;
    const returnFocus=target==='root'?Math.max(0,catalogs.root.findIndex(entry=>entry.navigation==='system')):1;
    await showCatalog(target,returnFocus);selected=false;
   })());
   return;
  }
  selected=true;report.titleId=games[index].titleId;report.exportKind=games[index].kind||'game';delete report.error;delete report.rawFallbackReason;delete report.exportInfo;delete report.allocationFailure;
  await publish(protocol.STATES.preparing,'Preparing '+games[index].name);
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
    engine.exports.prepareExport({attachment,entry,raw:rawMode,mounts:engine.mounts,content:engine.content,shouldStop}):
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
     const message=error.code==='PREPARATION_TIMEOUT'?'Preparation timed out. X: raw NCAs; or choose another title.':error.message;
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
     onProgress('OunceCake: No usable ELicense; serving original encrypted NCAs instead.');
     await publish(protocol.STATES.preparing,'No usable ELicense. Preparing original encrypted NCAs.');
     try{prepared=await prepare(true);}catch(rawError){await recover(rawError);return;}
    }else{await recover(error);return;}
   }
   report.exportInfo=prepared.exportInfo||null;
   if(raw)report.exportKind=prepared.exportInfo?.kind||'game-nca';
   if(stopping)return;
   check(await live(),'The held RPC session ended before HTTP/WebDAV deployment');
   try{server=await engine.server.deployServer({attachment,image:nativeImage,...prepared,port:8080});}
   catch(error){
    if(error.allocation)report.allocationFailure=error.allocation;
    if(error.code==='HTTP_SERVER_ALLOCATION_FAILED'&&error.retrySafe===true&&!blocked(error)){
     await recover(error);return;
    }
    throw error;
   }
   if(stopping)return;
   check(await live(),'The held RPC session ended during HTTP/WebDAV startup');
   report.httpURL='http://'+address+':8080/';
   await publish(protocol.STATES.running,(raw?'RAW HTTP://':'HTTP://')+address+':8080/');
   onProgress('OunceCake: '+report.httpURL);
  })());
 }
 async function back(){
  if(started&&!stopping&&!selected&&status===protocol.STATES.catalog&&view==='system')return select(0);
  check(started&&!stopping&&selected&&status===protocol.STATES.running,
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
   if(report.cleanupBlocked)throw failure||Object.assign(Error('OunceCake native cleanup is uncertain'),{cleanupBlocked:true});
   await releaseOwned();
   report.status='stopped';report.completed=new Date().toISOString();await save();
  })();
  return closing;
 }
 return {start,select,selectRaw:index=>select(index,{raw:true}),back,close,get report(){return {...report};}};
}
module.exports={create,ipv4};
