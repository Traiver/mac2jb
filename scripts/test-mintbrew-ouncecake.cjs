const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const catalog=require('../vendor/MintBrew/homebrew-launcher/app-catalog.cjs');
const layout=require('../vendor/MintBrew/sdk/host/layout.cjs');
const prepare=require('../integrations/mintbrew-ouncecake/prepare.cjs');
const protocol=require('../integrations/mintbrew-ouncecake/protocol.cjs');
const service=require('../integrations/mintbrew-ouncecake/service.cjs');
const root=path.resolve(__dirname,'..');

function network(address='192.0.2.20'){
 const bytes=Buffer.alloc(layout.FIELD.network+24);
 bytes.writeUInt32LE(layout.MAGIC,layout.FIELD.magic);
 bytes.writeUInt32LE(layout.VERSION,layout.FIELD.version);
 bytes.writeUInt32LE(layout.FLAGS.network,layout.FIELD.flags);
 address.split('.').forEach((part,index)=>bytes[layout.FIELD.network+20+index]=Number(part));
 return bytes;
}

async function waitFor(read,expected){
 const until=Date.now()+2000;
 while(Date.now()<until){if(read()===expected)return;await new Promise(resolve=>setTimeout(resolve,2));}
 assert.equal(read(),expected);
}

test('OunceCake app bundle and title raster stay within its private GPU buffer',async t=>{
 prepare.verifySource(root);
 const folder=path.join(root,'integrations/mintbrew-ouncecake/app');
 const app=await catalog.readApp(folder);
 assert.equal(app.manifest.service,'ouncecake-v1');
 assert.equal(app.files.memory.allocationBytes,protocol.STORAGE_BYTES);
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'mac2jb-ouncecake-app-'));
 t.after(()=>fs.rmSync(runtime,{recursive:true,force:true}));
 assert.ok(prepare.prepareMintBrew(root,runtime).files>8);
 assert.ok(prepare.verifyMintBrew(root,runtime).files>8);
 const input=path.join(runtime,'games.json'),output=path.join(runtime,'games.bin');
 fs.writeFileSync(input,JSON.stringify([{name:'A game'},{name:'A second game'}]));
 execFileSync('python3',[path.join(root,'integrations/mintbrew-ouncecake/raster.py'),input,output]);
 const image=fs.readFileSync(output);
 assert.equal(image.length,2*protocol.TILE_BYTES);
 assert.ok(image.some(byte=>byte!==0));
 assert.ok(protocol.HEADER_BYTES+protocol.MAX_GAMES*protocol.TILE_BYTES<protocol.STORAGE_BYTES);
});

test('console FTP address is taken only from qualified Switch network state',()=>{
 assert.equal(service.ipv4(network()),'192.0.2.20');
 const absent=network();absent.writeUInt32LE(0,layout.FIELD.flags);
 assert.throws(()=>service.ipv4(absent),/ready IPv4/);
 assert.throws(()=>service.ipv4(network('127.0.0.1')),/unusable IPv4/);
 const value=protocol.header(protocol.STATES.running,2,'http://192.0.2.20:8080/');
 assert.equal(value.readUInt32LE(0),protocol.MAGIC);
 assert.equal(value.readUInt32LE(4),protocol.STATES.running);
 assert.equal(value.subarray(128,128+value.readUInt32LE(16)).toString(),'http://192.0.2.20:8080/');
});

function fixture(t,{serverStopError,handleCloseError,detachError,prepareGame,exportsEngine,saveTools,saveServer,saveImporter,gameTar,preparationTimeoutMs,realRaster=false,reuseDirectory,deployError,rasterRows,onGameList}={}){
 const directory=reuseDirectory||fs.mkdtempSync(path.join(os.tmpdir(),'mac2jb-ouncecake-service-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const events={attach:0,detach:0,deployed:0,stopped:0,mounted:0,closed:[],order:[],fatal:[],writes:[]};
 const mapped=0x500000000,menu={controls:{mapped:0x600000000}};
 const rpc={a:{session:'mintbrew-test'},async write(address,bytes){events.writes.push({address,bytes:Buffer.from(bytes)});},
  async read(){return network();}};
 const modules={
  session:{async attachGame(){events.attach++;assert.equal(events.attach,1);
   const s={base:123,handles:new Set([1]),threads:new Set(),async close(handle){
    assert.ok(s.handles.has(handle));if(handleCloseError)throw handleCloseError;
    events.closed.push(handle);events.order.push('handle:'+handle);s.handles.delete(handle);
   }};
   return {live:{session:'switch-test'},s,async close(){
    if(detachError)throw detachError;
    for(const handle of [...s.handles].reverse())await s.close(handle);
    events.detach++;events.order.push('attachment-closed');s.base=0;
   }};}},
  content:{async discoverGames(){return [{title:'0100000000000001',name:'Test game',storages:[4]}];}},
  mounts:{async prepareGame(options){if(prepareGame)return prepareGame(options);
   const handle=100+(++events.mounted);options.attachment.s.handles.add(handle);
   return {index:Buffer.from('index'),sources:[{handle,kind:0,size:1}]};}},
  server:{async deployServer({attachment}){if(deployError)throw deployError;events.deployed++;attachment.s.handles.add(200+events.deployed);
   attachment.s.threads.add('ftp');
   return {async close(){events.stopped++;
   if(serverStopError)throw serverStopError;
   attachment.s.threads.delete('ftp');events.order.push('ftp-stopped');
   return {nativeStopped:true,joined:true,mappingsCleared:true};}};}}
 };
 if(exportsEngine)modules.exports=exportsEngine;
 const instance=service.create({rpc,menu,gpu:{fingerprint:'abc',privateStorage:{mapped,bytes:protocol.STORAGE_BYTES}},
  app:{id:'ouncecake',fingerprint:'abc',manifest:{service:'ouncecake-v1'}},directory,root,
  runDirectory:'/run/switch-test',sourceSession:'switch-test',modules,saveTools,saveServer,saveImporter,gameTar,preparationTimeoutMs,
  liveCheck:async()=>true,
  verifyHeld:async()=>({run:{directory:'/run/switch-test',proof:{session:'switch-test'},
   connection:{addresses:{session:'switch-test'}}},snapshot:{image:Buffer.from('native'),nativeImageSha256:'abc'}}),
  rasterGames:rasterRows||(realRaster?undefined:async games=>Buffer.alloc(games.length*protocol.TILE_BYTES,0xf0)),
  onGameList:async()=>{events.order.push('title-ftp-resumed');await onGameList?.();},
  onFatal:error=>events.fatal.push(error)});
 return {instance,events,directory};
}

test('A selects one game; short B closes FTP and allows another selection',async t=>{
 const {instance,events}=fixture(t);
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 assert.equal(events.attach,1);assert.equal(events.detach,0);
 await instance.select(0);await waitFor(()=>instance.report.status,'running');
 assert.equal(instance.report.httpURL,'http://192.0.2.20:8080/');
 const running=events.writes.map(row=>row.bytes).findLast(bytes=>bytes.length===protocol.HEADER_BYTES&&
  bytes.readUInt32LE(0)===protocol.MAGIC&&bytes.readUInt32LE(4)===protocol.STATES.running);
 assert.equal(running.subarray(128,128+running.readUInt32LE(16)).toString(),'HTTP://192.0.2.20:8080/');
 await instance.back();await waitFor(()=>instance.report.status,'catalog');
 assert.equal(events.stopped,1);assert.equal(events.detach,0);
 assert.deepEqual(events.closed.sort((a,b)=>a-b),[101,201]);
 assert.ok(events.order.indexOf('ftp-stopped')<events.order.indexOf('handle:201'));
 assert.ok(events.order.indexOf('ftp-stopped')<events.order.indexOf('handle:101'));
 await waitFor(()=>events.order.includes('title-ftp-resumed'),true);
 assert.ok(events.order.indexOf('handle:101')<events.order.indexOf('title-ftp-resumed'));
 await instance.select(0);await waitFor(()=>instance.report.status,'running');
 await instance.close();
 assert.equal(events.attach,1);assert.equal(events.stopped,2);assert.equal(events.detach,1);
 assert.equal(instance.report.status,'stopped');
 assert.equal(events.fatal.length,0);
});

test('a game offers TAR alongside its regular URL and stops TAR before the native download server',async t=>{
 const {instance,events}=fixture(t,{saveServer:{hostAddress:()=> '127.0.0.1'},
  gameTar:{async start({name,switchAddress}){assert.equal(name,'Test game [0100000000000001].tar');assert.equal(switchAddress,'192.0.2.20');
   return {url:'http://127.0.0.1:8081/',async close(){events.order.push('tar-stopped');}};}}});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.status,'running');
 assert.equal(instance.report.httpURL,'http://192.0.2.20:8080/');
 assert.equal(instance.report.tarURL,'http://127.0.0.1:8081/');
 await instance.back();await waitFor(()=>instance.report.status,'catalog');
 assert.ok(events.order.indexOf('tar-stopped')<events.order.indexOf('ftp-stopped'));
 assert.equal(instance.report.tarURL,undefined);
 await instance.close();
});

test('uncertain FTP shutdown keeps the held session blocked',async t=>{
 const failure=Object.assign(Error('join did not complete'),{cleanupBlocked:true});
 const {instance,events}=fixture(t,{serverStopError:failure});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.status,'running');
 await instance.back();await waitFor(()=>instance.report.cleanupBlocked,true);
 await assert.rejects(instance.close(),/join did not complete/);
 assert.equal(events.detach,0);
 assert.deepEqual(events.closed,[]);
 assert.equal(events.fatal.length,1);
});

test('selected-game handle cleanup must be proven before another selection',async t=>{
 const {instance,events}=fixture(t,{handleCloseError:Error('handle remained open')});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.status,'running');
 await instance.back();await waitFor(()=>instance.report.cleanupBlocked,true);
 assert.equal(events.stopped,1);
 assert.equal(events.detach,0);
 await assert.rejects(instance.close(),/handle remained open/);
 assert.equal(events.fatal.length,1);
});

test('cancelled game preparation closes the retained attachment without blocking',async t=>{
 let started;
 const prepared=new Promise(resolve=>{started=resolve;});
 const {instance,events}=fixture(t,{prepareGame:async({attachment,shouldStop})=>{
  attachment.s.handles.add(101);started();
  await waitFor(shouldStop,true);
  throw Object.assign(Error('FTP preparation cancelled'),{code:'FTP_CANCELLED'});
 }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await prepared;
 await instance.close();
 assert.equal(instance.report.status,'stopped');
 assert.equal(instance.report.cleanupBlocked,undefined);
 assert.equal(events.attach,1);
 assert.equal(events.detach,1);
 assert.deepEqual(events.closed,[101,1]);
 assert.equal(events.fatal.length,0);
});

test('cancelled preparation still blocks when attachment cleanup cannot be proven',async t=>{
 let started;
 const prepared=new Promise(resolve=>{started=resolve;});
 const {instance,events}=fixture(t,{detachError:Error('native free was deferred'),
  prepareGame:async({attachment,shouldStop})=>{
   attachment.s.handles.add(101);started();
   await waitFor(shouldStop,true);
   throw Object.assign(Error('FTP preparation cancelled'),{code:'FTP_CANCELLED'});
  }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await prepared;
 await assert.rejects(instance.close(),/native free was deferred/);
 assert.equal(instance.report.cleanupBlocked,true);
 assert.equal(events.detach,0);
 assert.deepEqual(events.closed,[]);
});

test('bad game content releases selected handles and returns to the catalog',async t=>{
 let attempts=0;
 const {instance,events}=fixture(t,{prepareGame:async({attachment})=>{
  const handle=100+(++attempts);attachment.s.handles.add(handle);
  if(attempts===1)throw Object.assign(Error('Invalid RomFS: header size'),{code:'ROMFS_HEADER_INVALID',romfsDiagnostic:{reason:'header-size',view:'/base/romfs',actualHeaderSize:'0x0'}});
  return {index:Buffer.from('index'),sources:[{handle,kind:0,size:1}]};
 }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.error,'Invalid RomFS: header size');
 assert.equal(instance.report.status,'catalog');
 assert.equal(instance.report.romfsDiagnostic.reason,'header-size');
 assert.equal(instance.report.romfsDiagnostic.view,'/base/romfs');
 assert.ok(instance.report.romfsDiagnostic.titleId);
 assert.equal(events.detach,0);
 assert.deepEqual(events.closed,[101]);
 await waitFor(()=>events.order.includes('title-ftp-resumed'),true);
 assert.equal(events.fatal.length,0);
 await instance.select(0);await waitFor(()=>instance.report.status,'running');
 assert.equal(instance.report.error,undefined);
 assert.equal(instance.report.romfsDiagnostic,undefined);
 await instance.close();
 assert.equal(events.attach,1);
 assert.equal(events.detach,1);
});

test('uncertain preparation error retains the native attachment',async t=>{
 const {instance,events}=fixture(t,{prepareGame:async({attachment})=>{
  attachment.s.handles.add(101);
  throw Error('Memory request timed out');
 }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.cleanupBlocked,true);
 await assert.rejects(instance.close(),/Memory request timed out/);
 assert.equal(events.detach,0);
 assert.deepEqual(events.closed,[]);
 assert.equal(events.fatal.length,1);
});

test('MintBrew selects a typed system export and still proves shutdown before another selection',async t=>{
 let prepared=0;
 const exportsEngine={async discoverExports(){return [{title:'0100000000000001',name:'System program',storages:[3],kind:'system-program',version:7}];},
  async prepareExport(args){assert.equal(args.entry.kind,'system-program');assert.equal(args.entry.version,7);prepared++;
   return {index:Buffer.alloc(64),sources:[{handle:7,kind:1,size:0}],exportInfo:{kind:'system-program',version:7}};}};
 const {instance,events}=fixture(t,{exportsEngine});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 assert.equal(instance.report.visibleEntries,2);await instance.selectRaw(0);
 await waitFor(()=>instance.report.catalogView,'system');await waitFor(()=>instance.report.status,'catalog');
 assert.equal(prepared,0);assert.equal(instance.report.visibleEntries,2);
 await instance.select(1);await waitFor(()=>instance.report.status,'running');
 assert.equal(prepared,1);assert.equal(instance.report.exportKind,'system-program');assert.equal(instance.report.exportInfo.version,7);
 await instance.back();await waitFor(()=>instance.report.status,'catalog');assert.equal(events.stopped,1);await instance.close();assert.equal(events.detach,1);
});

test('missing ELicense returns to the catalog instead of terminating MintBrew',async t=>{
 let attempts=0;const {instance,events}=fixture(t,{prepareGame:async({attachment})=>{
  attachment.s.handles.add(101);if(++attempts===1)throw Object.assign(Error('No installed account ELicense'),{code:'MISSING_ELICENSE'});
  return {index:Buffer.alloc(64),sources:[{handle:101}]};}});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>instance.report.error,'No installed account ELicense');
 assert.equal(instance.report.status,'catalog');assert.equal(events.fatal.length,0);assert.deepEqual(events.closed,[101]);
 await instance.select(0);await waitFor(()=>instance.report.status,'running');await instance.close();
});
test('license fallback proves partial cleanup before raw export and keeps the HTTP endpoint',async t=>{
 let closed,attempts=0;const exportsEngine={async discoverExports(){return [{title:'0400486024dec000',name:'Preload',storages:[4]}];},prepareTitleNcas(){},
  async prepareExport({attachment,raw}){if(!raw){attachment.s.handles.add(101);throw Object.assign(Error('No installed account ELicense'),{code:'MISSING_ELICENSE'});}
   assert.equal(attachment.s.handles.has(101),false);attempts++;return {index:Buffer.alloc(64),sources:[{handle:7}],exportInfo:{kind:'game-nca',encrypted:true}};}};
 const {instance,events}=fixture(t,{exportsEngine});await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>instance.report.status,'running');
 assert.equal(attempts,1);assert.equal(instance.report.exportKind,'game-nca');assert.equal(instance.report.exportInfo.encrypted,true);assert.equal(instance.report.httpURL,'http://192.0.2.20:8080/');assert.equal(events.fatal.length,0);await instance.close();
});
test('original-content fallback records the real cause without misreporting a missing license',async t=>{
 let closed,attempts=0;const exportsEngine={async discoverExports(){return [{title:'0400486024dec000',name:'Preload',storages:[4]}];},prepareTitleNcas(){},
  async prepareExport({attachment,raw}){if(!raw){attachment.s.handles.add(101);throw Object.assign(Error('Content requires an original-content mount'),{code:'GAME_ORIGINAL_CONTENT_REQUIRED'});}
   assert.equal(attachment.s.handles.has(101),false);attempts++;return {index:Buffer.alloc(64),sources:[{handle:7}],exportInfo:{kind:'game-nca',encrypted:true}};}};
 const {instance,events}=fixture(t,{exportsEngine});await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>instance.report.status,'running');
 assert.equal(instance.report.rawFallbackCode,'GAME_ORIGINAL_CONTENT_REQUIRED');assert.equal(instance.report.rawFallbackReason,'Content requires an original-content mount');assert.equal(attempts,1);assert.equal(instance.report.exportKind,'game-nca');assert.equal(instance.report.exportInfo.encrypted,true);assert.equal(instance.report.httpURL,'http://192.0.2.20:8080/');assert.equal(events.fatal.length,0);await instance.close();
});
test('explicit X/raw selection skips license preparation',async t=>{
 const exportsEngine={async discoverExports(){return [{title:'0400486024dec000',name:'Preload',storages:[4]}];},async prepareExport({raw}){assert.equal(raw,true);return {index:Buffer.alloc(64),sources:[{handle:7}],exportInfo:{kind:'game-nca'}};}};
 const {instance}=fixture(t,{exportsEngine});await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.selectRaw(0);await waitFor(()=>instance.report.status,'running');assert.equal(instance.report.exportKind,'game-nca');await instance.close();
});
test('cooperative preparation timeout returns to the catalog only after preparation settles',async t=>{
 let finished=false;const {instance,events}=fixture(t,{preparationTimeoutMs:10,prepareGame:async({attachment,shouldStop})=>{
  attachment.s.handles.add(101);while(!shouldStop())await new Promise(r=>setTimeout(r,2));finished=true;throw Object.assign(Error('cancelled'),{code:'FTP_CANCELLED'});
 }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>!!instance.report.error,true);
 assert.equal(finished,true);assert.equal(instance.report.status,'catalog');assert.equal(events.fatal.length,0);assert.deepEqual(events.closed,[101]);await instance.close();
});

test('OunceCake can close and reopen in the same run even when old catalog files remain',async t=>{
 const first=fixture(t,{realRaster:true});
 fs.writeFileSync(path.join(first.directory,'ouncecake-games.json'),'old catalog');
 fs.writeFileSync(path.join(first.directory,'ouncecake-games.bin'),'old raster');
 await first.instance.start();await waitFor(()=>first.instance.report.status,'catalog');await first.instance.close();
 const second=fixture(t,{realRaster:true,reuseDirectory:first.directory});
 await second.instance.start();await waitFor(()=>second.instance.report.status,'catalog');await second.instance.close();
 assert.equal(first.events.fatal.length,0);assert.equal(second.events.fatal.length,0);
 assert.equal(fs.readFileSync(path.join(first.directory,'ouncecake-games.json'),'utf8'),'old catalog');
 assert.equal(fs.readdirSync(first.directory).some(name=>name.startsWith('ouncecake-catalog-')),false);
});
test('verified HTTP allocation failure releases selected handles and offers split export after cleanup',async t=>{
 const error=Object.assign(Error('HTTP server allocation failed'),{code:'HTTP_SERVER_ALLOCATION_FAILED',retrySafe:true,allocation:{bytes:4096000}});
 const {instance,events}=fixture(t,{deployError:error});await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>instance.report.catalogView,'parts');
 assert.equal(instance.report.status,'catalog');assert.equal(instance.report.allocationFailure.bytes,4096000);assert.deepEqual(events.closed,[101]);assert.equal(events.fatal.length,0);await instance.close();
});
test('unverified HTTP allocation never returns to the catalog or frees selected resources',async t=>{
 const error=Object.assign(Error('invalid nonzero native pointer'),{code:'HTTP_SERVER_ALLOCATION_FAILED',cleanupBlocked:true,allocation:{bytes:4096000}});
 const {instance,events}=fixture(t,{deployError:error});await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>instance.report.cleanupBlocked,true);
 assert.equal(instance.report.status,'preparing');assert.deepEqual(events.closed,[]);assert.equal(events.fatal.length,1);await assert.rejects(instance.close(),/invalid nonzero/);
});


test('System Files groups only system entries and Back restores the folder without rediscovery',async t=>{
 const views=require('../integrations/mintbrew-ouncecake/catalog.cjs').views;
 const game={title:'0100000000000001',name:'Game',storages:[4],kind:'game'};
 const system={title:'0100000000000002',name:'System',storages:[3],kind:'system-data'};
 const firmware={title:'0000000000000000',name:'Firmware',storages:[3],kind:'firmware-nca'};
 const pages=views([firmware,system,game]);
 assert.equal(pages.root[0],firmware);assert.equal(pages.root[1].saveLibrary,true);assert.equal(pages.root[2],game);
 assert.equal(pages.root[3].name,'[Folder] System Files (1)');
 assert.equal(pages.system[0].name,'[..] Back');assert.equal(pages.system[1],system);
 assert.equal(views([game]).root.length,2);
 assert.equal(views(Array(1000).fill(system)).system.length,1001);
 let discoveries=0,preparations=0;
 const {instance,events}=fixture(t,{exportsEngine:{async discoverExports(){discoveries++;return [game,system];},
  async prepareExport(){preparations++;throw Error('Navigation must not prepare content');}}});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.selectRaw(2);await waitFor(()=>instance.report.catalogView,'system');await waitFor(()=>instance.report.status,'catalog');
 let header=events.writes.at(-1).bytes;
 assert.equal(header.readUInt32LE(12),2);assert.equal(header.readUInt32LE(20),1);assert.equal(header.readUInt32LE(24),1);
 await instance.back();await waitFor(()=>instance.report.catalogView,'root');await waitFor(()=>instance.report.status,'catalog');
 header=events.writes.at(-1).bytes;
 assert.equal(header.readUInt32LE(12),3);assert.equal(header.readUInt32LE(20),0);assert.equal(header.readUInt32LE(24),2);
 await instance.select(2);await waitFor(()=>instance.report.catalogView,'system');await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.catalogView,'root');await waitFor(()=>instance.report.status,'catalog');
 assert.equal(discoveries,1);assert.equal(preparations,0);assert.deepEqual(events.closed,[]);assert.equal(events.deployed,0);
 await instance.close();assert.equal(events.detach,1);
});

test('catalog navigation header validates capacity and navigation metadata',()=>{
 const header=protocol.header(protocol.STATES.catalog,1001,'',42,true,1000);
 assert.equal(header.readUInt32LE(8),1001);assert.equal(header.readUInt32LE(12),42);
 assert.equal(header.readUInt32LE(20),1);assert.equal(header.readUInt32LE(24),1000);
 assert.throws(()=>protocol.header(1,1002),/display state/);
 assert.throws(()=>protocol.header(1,1,'',-1),/navigation/);
 assert.throws(()=>protocol.header(1,1,'',0,1),/navigation/);
 assert.throws(()=>protocol.header(1,1,'',0,false,1002),/navigation/);
});

test('large export is split before deployment and category choices reach the exporter',async t=>{
 const parts=[];let first=true;const {instance,events}=fixture(t,{exportsEngine:{async discoverExports(){return [{title:'0100000000000001',name:'Large game',storages:[4]}];},async prepareExport({attachment,part}){
  parts.push(part);attachment.s.handles.add(101);const index=Buffer.alloc(first?9*1024*1024:64);first=false;return {index,sources:[{handle:101,kind:0,size:1}]};
 }}});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>instance.report.catalogView,'parts');
 assert.equal(events.deployed,0);assert.deepEqual(events.closed,[101]);
 for(let i=1;i<=4;i++){await instance.select(i);await waitFor(()=>instance.report.status,'running');await instance.back();await waitFor(()=>instance.report.status,'catalog');}
 assert.deepEqual(parts,[undefined,'base','update','dlc','additional']);
 await instance.back();await waitFor(()=>instance.report.catalogView,'root');await instance.select(0);await waitFor(()=>instance.report.catalogView,'parts');assert.equal(parts.length,5);await instance.close();
});
test('split menu labels are English and preserve the title identity',()=>{
 const rows=require('../integrations/mintbrew-ouncecake/catalog.cjs').parts({titleId:'0100000000000001',name:'Large game'});
 assert.deepEqual(rows.map(row=>row.name),['[..] Back','Base','Update','DLC','Additional Content']);assert.equal(rows[4].titleId,'0100000000000001');
});

test('selected Unicode title raster has a separate bounded slot and visibility flag',()=>{
 assert.ok(protocol.TITLE_TILE_INDEX>=protocol.MAX_GAMES);
 assert.ok(protocol.HEADER_BYTES+(protocol.TITLE_TILE_INDEX+1)*protocol.TILE_BYTES<=protocol.STORAGE_BYTES);
 assert.equal(protocol.header(2,1,'Preparing',0,false,0,true).readUInt32LE(28),1);
 assert.equal(protocol.header(1,1).readUInt32LE(28),0);
 assert.throws(()=>protocol.header(1,1,'',0,false,0,1));
});

test('Japanese selected title stays in its Unicode image tile while operational messages remain ASCII',async t=>{
 const rows=[];const title='ゼルダの伝説 時のオカリナ';
 const headingRaster=Promise.withResolvers();
 t.after(()=>headingRaster.resolve());
 const {instance,events}=fixture(t,{rasterRows:async games=>{
  rows.push(games);
  if(games[0].heading)await headingRaster.promise;
  return Buffer.alloc(games.length*protocol.TILE_BYTES);
 },exportsEngine:{async discoverExports(){return [{title:'0400486024dec000',name:title,storages:[4]}];},async prepareExport(){return {index:Buffer.alloc(64),sources:[{handle:7}]};}}});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 const selection=instance.select(0);
 await waitFor(()=>instance.report.status,'preparing');
 await selection;
 const preparing=events.writes.findLast(row=>row.bytes.length===protocol.HEADER_BYTES).bytes;
 assert.equal(preparing.readUInt32LE(28),0);
 headingRaster.resolve();
 await waitFor(()=>instance.report.status,'running');
 const heading=rows.flat().find(row=>row.heading);assert.equal(heading.name,title);assert.equal(heading.titleId,'0400486024dec000');
 assert.ok(events.writes.some(row=>row.address===0x500000000+protocol.HEADER_BYTES+protocol.TITLE_TILE_INDEX*protocol.TILE_BYTES));
 const header=events.writes.findLast(row=>row.bytes.length===protocol.HEADER_BYTES).bytes;assert.equal(header.readUInt32LE(28),1);
 await instance.back();await waitFor(()=>instance.report.status,'catalog');assert.equal(events.writes.findLast(row=>row.bytes.length===protocol.HEADER_BYTES).bytes.readUInt32LE(28),0);
 await instance.close();
});


test('zero base RomFS header offers scoped exports only after cleanup and permits a separate update',async t=>{
 const parts=[];const {instance,events}=fixture(t,{exportsEngine:{
  async discoverExports(){return [{title:'0100000000000001',name:'Sparse base',storages:[4]}];},
  async prepareExport({attachment,part}){
   parts.push(part);attachment.s.handles.add(101);
   if(!part)throw Object.assign(Error('Invalid RomFS: header size'),{code:'ROMFS_HEADER_INVALID',romfsDiagnostic:{zeroHeader:true,contentType:1,view:'/base/romfs',actualHeaderSize:'0x0'}});
   return {index:Buffer.alloc(64),sources:[{handle:101,kind:0,size:1}]};
  }
 }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.catalogView,'parts');
 assert.equal(instance.report.splitReason,'ZERO_BASE_ROMFS_HEADER');
 assert.equal(instance.report.romfsDiagnostic.zeroHeader,true);
 assert.deepEqual(events.closed,[101]);assert.equal(events.fatal.length,0);
 await instance.select(2);await waitFor(()=>instance.report.status,'running');
 assert.deepEqual(parts,[undefined,'update']);assert.equal(instance.report.romfsDiagnostic,undefined);
 await instance.close();
});

test('partial Base export is visibly marked and keeps unavailable-section evidence',async t=>{
 const info={kind:'game',partial:true,sections:[{path:'/base/exefs',status:'available',entries:1},{path:'/base/romfs',status:'invalid',message:'Invalid RomFS: header size'}]};
 const {instance,events}=fixture(t,{exportsEngine:{
  async discoverExports(){return [{title:'0100000000000001',name:'Partial Base',storages:[4]}];},
  async prepareExport({attachment}){attachment.s.handles.add(101);return {index:Buffer.alloc(64),sources:[{handle:101,kind:1}],exportInfo:info};}
 }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.status,'running');
 assert.deepEqual(instance.report.exportInfo,info);assert.equal(events.deployed,1);
 const header=events.writes.filter(x=>x.bytes.length===protocol.HEADER_BYTES).at(-1).bytes;
 const message=header.subarray(128,128+header.readUInt32LE(16)).toString();
 assert.ok(message.startsWith('PARTIAL HTTP://'));assert.equal(events.fatal.length,0);
 await instance.close();
});


test('compacted Base metadata offers export scopes safely with an explanatory message',async t=>{
 const error=Object.assign(Error('Compacted Base. Choose Update for installed files; X for raw NCAs.'),{code:'COMPACTED_BASE',exportInfo:{kind:'game',baseCompacted:true,updateAvailable:true}});
 const {instance,events}=fixture(t,{prepareGame:async()=>{throw error;}});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.catalogView,'parts');
 assert.equal(instance.report.splitReason,'COMPACTED_BASE');assert.equal(instance.report.exportInfo.baseCompacted,true);
 assert.equal(events.deployed,0);assert.equal(events.fatal.length,0);await instance.close();
});
test('combined installed view of compacted Base and Update is visibly identified',async t=>{
 const info={kind:'game',baseCompacted:true,merged:true,partial:false,sections:[]};
 const {instance,events}=fixture(t,{exportsEngine:{
  async discoverExports(){return [{title:'0100000000000001',name:'Compacted game',storages:[4]}];},
  async prepareExport({attachment}){attachment.s.handles.add(101);return {index:Buffer.alloc(64),sources:[{handle:101,kind:0,size:1}],exportInfo:info};}
 }});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.select(0);await waitFor(()=>instance.report.status,'running');
 const header=events.writes.filter(x=>x.bytes.length===protocol.HEADER_BYTES).at(-1).bytes;
 assert.ok(header.subarray(128,128+header.readUInt32LE(16)).toString().startsWith('COMBINED HTTP://'));
 assert.equal(instance.report.exportInfo.merged,true);await instance.close();
});


const saveArchive={id:'12',space:1,type:1,rank:0,index:0,uid:'0'.repeat(32),titleId:'0100000000000001',size:'16'};
function saveFixture(t,{inventoryError,snapshotError,startError,pending}={}){
 const saveEvents={copied:0,started:0,closed:0};
 const saveTools={label:()=> 'Shared / Account / NAND / Index 0',async withProfiles({archives}){return archives;},
  async inventory({attachment}){attachment.s.handles.add(301);if(inventoryError)throw inventoryError;return [saveArchive];},
  async snapshot({attachment,shouldStop}){saveEvents.copied++;attachment.s.handles.add(302);
   if(pending){await pending;assert.equal(shouldStop(),true);throw Object.assign(Error('cancelled'),{code:'FTP_CANCELLED'});}
   if(snapshotError)throw snapshotError;return {folder:'/backup/test',manifest:{files:2,bytes:8}};}};
 const saveServer={hostAddress:()=> '192.0.2.1',async start(){saveEvents.started++;if(startError)throw startError;
  return {kind:'local-save',url:'http://192.0.2.1:12345/abcd/',async close(){saveEvents.closed++;return {localStopped:true,connectionsClosed:true};}};}};
 return {...fixture(t,{saveTools,saveServer}),saveEvents};
}
test('Y Saves opens exact archive choices and local backup download, then returns without a new exploit',async t=>{
 const {instance,events,saveEvents}=saveFixture(t);await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.selectRaw(0x40000000);await waitFor(()=>instance.report.catalogView,'saves');await waitFor(()=>instance.report.status,'catalog');
 assert.ok(events.closed.includes(301));
 const header=events.writes.filter(x=>x.bytes.length===protocol.HEADER_BYTES).at(-1).bytes;assert.equal(header.readUInt32LE(32),2);
 await instance.select(1);await waitFor(()=>instance.report.status,'running');
 assert.equal(instance.report.exportKind,'save-data');assert.equal(instance.report.saveBackup.files,2);
 assert.equal(instance.report.httpURL,'http://192.0.2.1:12345/abcd/');assert.equal(events.deployed,0);
 assert.ok(events.closed.includes(302));assert.equal(saveEvents.copied,1);
 await instance.back();await waitFor(()=>instance.report.status,'catalog');assert.equal(saveEvents.closed,1);
 await instance.back();await waitFor(()=>instance.report.catalogView,'root');await waitFor(()=>instance.report.status,'catalog');
 await instance.select(0);await waitFor(()=>instance.report.status,'running');assert.equal(events.deployed,1);assert.equal(events.attach,1);
 await instance.close();assert.equal(events.detach,1);
});
test('save inventory, copy and download failures recover to the list without raw NCA fallback',async t=>{
 for(const failure of [{inventoryError:Error('No archive access')},{snapshotError:Error('Short save read')},{startError:Error('Port unavailable')}]){
  const {instance,events}=saveFixture(t,failure);await instance.start();await waitFor(()=>instance.report.status,'catalog');
  await instance.selectSaves(0);
  if(!failure.inventoryError){await waitFor(()=>instance.report.catalogView,'saves');await waitFor(()=>instance.report.status,'catalog');await instance.select(1);}
  await waitFor(()=>Boolean(instance.report.error),true);await waitFor(()=>instance.report.status,'catalog');
  assert.equal(events.mounted,0);assert.equal(events.deployed,0);assert.equal(events.fatal.length,0);await instance.close();
 }
});
test('closing OunceCake waits for save cancellation before releasing its attachment',async t=>{
 let resolve;const pending=new Promise(r=>{resolve=r;});const {instance,events,saveEvents}=saveFixture(t,{pending});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');await instance.selectSaves(0);
 await waitFor(()=>instance.report.catalogView,'saves');await waitFor(()=>instance.report.status,'catalog');await instance.select(1);
 await waitFor(()=>saveEvents.copied,1);const close=instance.close();assert.equal(events.detach,0);resolve();await close;
 assert.equal(saveEvents.started,0);assert.equal(events.detach,1);assert.ok(events.closed.includes(302));
});
test('unsafe save cleanup retains resources and calls the fatal handler',async t=>{
 const error=Object.assign(Error('save handle close failed'),{cleanupBlocked:true});
 const {instance,events}=saveFixture(t,{snapshotError:error});await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.selectSaves(0);await waitFor(()=>instance.report.catalogView,'saves');await waitFor(()=>instance.report.status,'catalog');
 await instance.select(1);await waitFor(()=>instance.report.cleanupBlocked,true);await assert.rejects(instance.close(),/save handle close/);
 assert.equal(events.detach,0);assert.equal(events.fatal.length,1);
});


test('Save Games follows firmware and browses uninstalled saves, profiles and a bulk HTTP export',async t=>{
 const removed='0400123456790000',installed='0100000000000001',scans=[],snapshots=[],deployments=[];let visible=[];
 const archives=[{...saveArchive,titleId:installed,userName:'Player'}, {...saveArchive,id:'13',titleId:removed,userName:'Other player'}];
 const saveTools={label:a=>a.userName,
  async inventory({titleId}){scans.push(titleId);return archives;},async withProfiles({archives}){return archives;},
  async titleNames(){return new Map([[installed,'Installed game'],[removed,'Uninstalled game']]);},
  async snapshot({archive}){snapshots.push(archive);return {folder:'/backup/one',manifest:{files:1,bytes:3}};},
  async snapshotAll({archives:rows}){assert.deepEqual(rows.map(a=>a.titleId),[installed,removed]);return {folder:'/backup/all',manifest:{files:4,bytes:12,partial:false,failed:[],archives:rows}};}};
 const saveServer={hostAddress:()=> '192.0.2.1',async start({name}){deployments.push(name);return {kind:'local-save',url:'http://192.0.2.1:8081/',async close(){return {localStopped:true,connectionsClosed:true};}};}};
 const {instance,events}=fixture(t,{saveTools,saveServer,
  exportsEngine:{async discoverExports(){return [{title:'fffffffffffffff0',name:'Firmware',kind:'firmware-nca',storages:[3]},{title:installed,name:'Installed game',storages:[4]}];},async prepareExport(){throw Error('Saved titles must not use game-content mounts');}},
  rasterRows:async rows=>{visible=rows;return Buffer.alloc(rows.length*protocol.TILE_BYTES);}});
 await instance.start();await waitFor(()=>instance.report.status,'catalog');assert.equal(visible[0].kind,'firmware-nca');assert.equal(visible[1].saveLibrary,true);
 await instance.select(1);await waitFor(()=>instance.report.catalogView,'save-games');await waitFor(()=>instance.report.status,'catalog');
 assert.deepEqual(scans,[undefined]);assert.equal(instance.report.saveLibrary.archives,2);
 assert.match(visible[1].name,/Export All Saves/);
 const index=visible.findIndex(row=>row.saveGroup===removed);assert.ok(index>1);
 await instance.select(index);await waitFor(()=>instance.report.catalogView,'saves');await waitFor(()=>instance.report.status,'catalog');
 assert.equal(visible[1].name,'Other player');await instance.select(1);await waitFor(()=>instance.report.status,'running');
 assert.equal(snapshots[0].titleId,removed);await instance.back();await waitFor(()=>instance.report.status,'catalog');
 await instance.back();await waitFor(()=>instance.report.catalogView,'save-games');await waitFor(()=>instance.report.status,'catalog');
 await instance.select(1);await waitFor(()=>instance.report.status,'running');assert.equal(instance.report.exportKind,'save-collection');
 assert.equal(instance.report.saveBackup.archives,2);assert.equal(deployments.at(-1),'All Saves');assert.equal(events.deployed,0);
 await instance.back();await waitFor(()=>instance.report.status,'catalog');await instance.back();await waitFor(()=>instance.report.catalogView,'root');
 await instance.close();assert.equal(events.detach,1);
});


test('a partial bulk backup is explicitly marked in the UI and share name',async t=>{
 const entry={...saveArchive,userName:'Player'},failed=[{selection:{...saveArchive,id:'13'},message:'Save is busy'}];let shareName;
 const saveTools={label:()=> 'Player',async inventory(){return [entry];},async withProfiles({archives}){return archives;},
  async titleNames(){return new Map([[entry.titleId,'Test game']]);},async snapshotAll(){return {folder:'/backup/partial',manifest:{partial:true,failed,archives:[entry],files:1,bytes:3}};}};
 const saveServer={hostAddress:()=> '192.0.2.1',async start({name}){shareName=name;return {kind:'local-save',url:'http://192.0.2.1:8081/',async close(){return {localStopped:true,connectionsClosed:true};}};}};
 const {instance,events}=fixture(t,{saveTools,saveServer});await instance.start();await waitFor(()=>instance.report.status,'catalog');
 await instance.select(1);await waitFor(()=>instance.report.catalogView,'save-games');await waitFor(()=>instance.report.status,'catalog');await instance.select(1);await waitFor(()=>instance.report.status,'running');
 assert.equal(shareName,'All Saves (partial)');assert.equal(instance.report.saveBackup.partial,true);
 const header=events.writes.filter(x=>x.bytes.length===protocol.HEADER_BYTES).at(-1).bytes;
 assert.match(header.subarray(128,128+header.readUInt32LE(16)).toString(),/^PARTIAL http:/);await instance.close();
});

const importFiles=require('../integrations/mintbrew-ouncecake/save-import-files.cjs');
const importSaves=require('../integrations/mintbrew-ouncecake/saves.cjs');
const importArchive={id:'12',space:1,type:1,rank:0,index:0,uid:'00112233445566778899aabbccddeeff',titleId:'0400123456780000',size:'16'};
async function importFixture(t,{restore,archive=importArchive}={}){
 let restores=0,scans=0;
 const f=fixture(t,{saveTools:{...importSaves,async inventory(){if(++scans===2&&archive.type!==2)assert.equal(f.instance.report.status,'preparing');return [archive];},async withProfiles({archives}){return archives;}},
  exportsEngine:{async discoverExports(){return [{title:archive.titleId,name:'Import game',storages:[4],kind:'game'}];}},
  saveImporter:{async restore(options){restores++;return restore?restore(options):{verified:true,backupPath:'/test-backup'};}}});
 await f.instance.start();await waitFor(()=>f.instance.report.status,'catalog');
 await f.instance.selectSaves(0);await waitFor(()=>f.instance.report.catalogView,'saves');await waitFor(()=>f.instance.report.status,'catalog');
 await f.instance.selectRaw(1);await waitFor(()=>f.instance.report.status,archive.type===2?'catalog':'importing');
 const folders=fs.existsSync(path.join(f.directory,'save-imports'))?fs.readdirSync(path.join(f.directory,'save-imports')):[];
 return {...f,get restores(){return restores;},folder:folders.length?path.join(fs.realpathSync(f.directory),'save-imports',folders[0]):undefined};
}
async function stageFixture(f){
 const source=path.join(f.directory,'source');fs.mkdirSync(path.join(source,'files'),{recursive:true});fs.writeFileSync(path.join(source,'files/slot'),'edited');
 fs.writeFileSync(path.join(source,'manifest.json'),JSON.stringify({format:'mac2jb.save-backup',version:1,readOnly:true,partial:false,titleId:importArchive.titleId,selection:importArchive,files:0,entries:[],directories:[]}));
 const plan=await importFiles.stage({folder:f.folder,source});await importFiles.command(f.folder,'confirm',plan.digest);return plan;
}
test('Switch X requests a Mac import; no write runs until confirmation is consumed at a launcher boundary',async t=>{
 let options;const f=await importFixture(t,{restore:async o=>{options=o;await o.onState({phase:'complete',verified:true});return {verified:true,backupPath:'/backup'};}});
 assert.equal(f.restores,0);assert.equal(await f.instance.pending(),false);
 await f.instance.afterBatch();assert.equal(f.restores,0);
 await stageFixture(f);assert.equal(await f.instance.pending(),true);
 await f.instance.afterBatch();await waitFor(()=>f.instance.report.status,'catalog');
 assert.equal(f.restores,1);assert.equal(options.confirmed,true);assert.equal(options.archive.uid,importArchive.uid);
 assert.equal(await f.instance.pending(),false);await f.instance.afterBatch();assert.equal(f.restores,1);
 assert.equal((await importFiles.json(path.join(f.folder,'result.json'))).phase,'complete');await f.instance.close();
});
test('B cancels waiting imports and invalidates delayed Mac confirmations without writes',async t=>{
 const f=await importFixture(t);await f.instance.back();assert.equal(f.instance.report.status,'catalog');assert.equal(f.restores,0);
 assert.equal((await importFiles.json(path.join(f.folder,'result.json'))).phase,'cancelled');
 assert.ok(f.events.order.includes('title-ftp-resumed'));
 await assert.rejects(importFiles.command(f.folder,'confirm','f'.repeat(64)),{code:'ENOENT'});await f.instance.close();
});
test('a stale B request during writing is ignored, while close waits for the import to settle',async t=>{
 let release,entered=false;const waiting=new Promise(r=>release=r);
 const f=await importFixture(t,{restore:async o=>{entered=true;await waiting;await o.onState({phase:'complete',verified:true});return {verified:true,backupPath:'/backup'};}});
 await stageFixture(f);await f.instance.afterBatch();await waitFor(()=>entered,true);
 await f.instance.back();assert.equal(f.restores,1);
 let closed=false;const closing=f.instance.close().then(()=>closed=true);await new Promise(r=>setTimeout(r,10));assert.equal(closed,false);
 release();await closing;assert.equal(f.instance.report.status,'stopped');assert.equal(f.events.fatal.length,0);
});
test('a wrong confirmation nonce is rejected and BCAT stays export-only',async t=>{
 const f=await importFixture(t);await importFiles.atomic(path.join(f.folder,'command.json'),{action:'confirm',nonce:'f'.repeat(48),digest:'f'.repeat(64)});
 await f.instance.afterBatch();assert.equal(f.restores,0);assert.equal(f.instance.report.status,'catalog');await f.instance.close();
 const bcat=await importFixture(t,{archive:{...importArchive,type:2}});assert.equal(bcat.folder,undefined);assert.equal(bcat.restores,0);await bcat.instance.close();
});
test('uncertain import failure reaches the Mac result and blocks the native session',async t=>{
 const f=await importFixture(t,{restore:async o=>{await o.onState({phase:'writing',backupPath:'/backup'});throw Object.assign(Error('commit uncertain'),{cleanupBlocked:true,backupPath:'/backup'});}});
 await stageFixture(f);await f.instance.afterBatch();await waitFor(()=>f.events.fatal.length,1);
 const result=await importFiles.json(path.join(f.folder,'result.json'));assert.equal(result.phase,'failed');assert.equal(result.cleanupBlocked,true);assert.equal(result.writeMayHaveOccurred,true);
 await assert.rejects(f.instance.close(),/commit uncertain/);assert.equal(f.restores,1);
});

test('the next catalog selection waits for the previous close and handoff to settle',async t=>{
 let release;const handoff=new Promise(r=>release=r);
 const f=fixture(t,{onGameList:()=>handoff});await f.instance.start();await waitFor(()=>f.instance.report.status,'catalog');
 await f.instance.select(0);await waitFor(()=>f.instance.report.status,'running');await f.instance.back();await waitFor(()=>f.instance.report.status,'catalog');
 const next=f.instance.select(0);await new Promise(r=>setTimeout(r,10));assert.equal(f.events.mounted,1);
 release();await next;await waitFor(()=>f.instance.report.status,'running');assert.equal(f.events.mounted,2);await f.instance.close();
});

async function webFixture(t,{archive=importArchive,beforeCommit}={}){
 const real=require('../integrations/mintbrew-ouncecake/save-server.cjs'),http=require('node:http');
 const {createHash}=require('node:crypto');let server,restores=0,pending,content='original';
 async function snapshot({directory}){
  fs.mkdirSync(directory,{recursive:true});const folder=fs.mkdtempSync(path.join(directory,'backup-'));
  fs.mkdirSync(path.join(folder,'files'));fs.writeFileSync(path.join(folder,'files','slot'),content);
  const bytes=Buffer.byteLength(content);
  const manifest={format:'mac2jb.save-backup',version:1,titleId:archive.titleId,selection:archive,readOnly:true,partial:false,
   files:1,bytes,directories:[],entries:[{path:'slot',size:bytes,sha256:createHash('sha256').update(content).digest('hex')}]};
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(manifest));return {folder,manifest};
 }
 const f=fixture(t,{saveTools:{...importSaves,async inventory(){return [archive];},async withProfiles({archives}){return archives;},snapshot},
  exportsEngine:{async discoverExports(){return [{title:archive.titleId,name:'Import game',storages:[4],kind:'game'}];}},
  saveServer:{hostAddress:()=> '127.0.0.1',async start(opts){server=await real.start({...opts,port:0});return server;}},
  saveImporter:{async restore(options){restores++;pending=options;
   const plan=await importFiles.planAt(options.folder,options.digest);
   await beforeCommit?.();
   content=fs.readFileSync(path.join(plan.stageRoot,'slot'),'utf8');
   const verified=await snapshot({directory:f.directory});
   const result={phase:'complete',verified:true,backupPath:'/backup',verifiedPath:verified.folder};
   await options.onState(result);return result;
  }}});
 const agent=new http.Agent({keepAlive:true,maxSockets:1});
 t.after(()=>{agent.destroy();return server?.close();});
 await f.instance.start();await waitFor(()=>f.instance.report.status,'catalog');
 await f.instance.selectSaves(0);await waitFor(()=>f.instance.report.catalogView,'saves');await waitFor(()=>f.instance.report.status,'catalog');
 await f.instance.select(1);await waitFor(()=>f.instance.report.status,archive.type===2?'running':'saveTransfer');
 const header=()=>f.events.writes.filter(x=>x.bytes.length===protocol.HEADER_BYTES).at(-1).bytes;
 const notice=()=>{const h=header();return h.subarray(256,256+h.readUInt32LE(36)).toString();};
 const send=(method,remote,body)=>new Promise((resolve,reject)=>{
  const req=http.request(new URL(remote,server.url),{method,agent},res=>{
   const chunks=[],port=res.socket.localPort;
   res.on('data',chunk=>chunks.push(chunk));
   res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString(),port}));
  });
  req.on('error',reject);req.end(body);
 });
 const title='Import game ['+archive.titleId+']',titlePath=encodeURIComponent(title)+'/';
 const sendInTitle=(method,remote,body)=>send(method,titlePath+remote,body);
 return {...f,notice,title,send,sendInTitle,get restores(){return restores;},get pending(){return pending;}};
}
test('combined save session keeps both folders and the same connection through multiple verified imports',async t=>{
 let release;const waiting=new Promise(r=>release=r);
 const f=await webFixture(t,{beforeCommit:()=>waiting}),url=f.instance.report.httpURL;
 t.after(release);
 const listing=await f.send('PROPFIND','');
 assert.equal(new URL(url).pathname,'/');
 assert.ok(listing.body.includes('<d:displayname>'+f.title+'</d:displayname>'));
 assert.match(listing.body,/Export\//);assert.match(listing.body,/Import\//);
 await f.instance.select(0);assert.equal(f.instance.report.status,'saveTransfer');assert.equal(f.restores,0);
 for(const [previous,edited] of [['original','edited'],['edited','again']]){
  const exportBackup=f.instance.report.saveBackup.folder;
  assert.equal((await f.sendInTitle('PUT','Import/slot',edited)).status,201);
  await f.instance.afterBatch();assert.equal((await f.sendInTitle('GET','Export/files/slot')).body,previous);
  await f.instance.select(0);
  if(previous==='original'){
   await waitFor(()=>f.restores,1);
   assert.equal((await f.sendInTitle('PUT','Import/slot','too late')).status,403);
   assert.equal((await f.sendInTitle('GET','Export/files/slot')).body,previous);
   release();
  }
  await waitFor(()=>f.instance.report.status,'saveTransfer');
  assert.equal(f.instance.report.httpURL,url);
  assert.equal(f.pending.exportBackup,exportBackup);
  const download=await f.sendInTitle('GET','Export/files/slot');
  assert.equal(download.body,edited);assert.equal(download.port,listing.port);
  assert.equal((await f.sendInTitle('GET','Import/slot')).status,404);
 }
 assert.equal(f.restores,2);assert.equal(f.pending.archive.uid,importArchive.uid);assert.equal(f.pending.confirmed,true);
 await f.instance.afterBatch();assert.equal(f.restores,2);
 assert.equal(f.events.detach,0);await f.instance.back();await waitFor(()=>f.instance.report.status,'catalog');
 await f.instance.close();assert.equal(f.events.detach,1);
});
test('WebDAV unwraps a dragged Export/files folder with one confirmation',async t=>{
 const f=await webFixture(t),url=f.instance.report.httpURL;
 assert.equal((await f.sendInTitle('MKCOL','Import/files')).status,201);
 assert.equal((await f.sendInTitle('PUT','Import/files/slot','edited')).status,201);
 assert.equal((await f.sendInTitle('GET','Export/files/slot')).body,'original');
 assert.equal(f.restores,0);
 await f.instance.select(0);
 await waitFor(()=>f.instance.report.status,'saveTransfer');
 assert.equal(f.instance.report.httpURL,url);
 assert.equal((await f.sendInTitle('GET','Export/files/slot')).body,'edited');assert.equal(f.restores,1);
 await f.instance.close();
});
test('WebDAV refuses mixing a dragged files folder and loose uploads',async t=>{
 const f=await webFixture(t);
 assert.equal((await f.sendInTitle('MKCOL','Import/files')).status,201);
 assert.equal((await f.sendInTitle('PUT','Import/files/slot','edited')).status,201);
 assert.equal((await f.sendInTitle('PUT','Import/slot','loose')).status,201);
 await f.instance.select(0);
 await waitFor(f.notice,'Upload the files folder by itself, or upload its contents directly.');
 assert.equal((await f.sendInTitle('GET','Export/files/slot')).body,'original');assert.equal(f.restores,0);
 await f.instance.close();
});
test('B closes a session with unconfirmed uploads; BCAT uses the read-only endpoint',async t=>{
 const f=await webFixture(t);
 assert.equal((await f.sendInTitle('PUT','Import/slot','edited')).status,201);
 assert.equal((await f.sendInTitle('GET','Export/files/slot')).body,'original');assert.equal(f.restores,0);
 await f.instance.back();await waitFor(()=>f.instance.report.status,'catalog');
 assert.equal(f.restores,0);await f.instance.close();
 const bcat=await webFixture(t,{archive:{...importArchive,type:2}});
 assert.equal(new URL(bcat.instance.report.httpURL).pathname,'/');
 assert.equal((await bcat.sendInTitle('PUT','Import/slot','edited')).status,404);
 assert.equal((await bcat.sendInTitle('GET','files/slot')).body,'original');
 await bcat.instance.close();
});
