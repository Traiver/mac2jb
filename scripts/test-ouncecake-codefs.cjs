'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const protocol=require('../vendor/OunceCake/engine/protocol.cjs');
function fixture({initialResult=0xa1e44802,retryResult=0,previous=null,selectionMismatch=false,restoreFails=false}={}){
 const filename=path.resolve(__dirname,'../vendor/OunceCake/engine/program.cjs');
 const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;
 loaded.require=name=>name==='node:fs/promises'?{async readFile(file){assert.ok(file.endsWith('owned-loader-root-copy.json'));return JSON.stringify({copy:{handle:7}});}}:module.require(Module._resolveFilename(name,loaded));
 loaded._compile(fs.readFileSync(filename,'utf8'),filename);
 const source={applicationTitle:'040094b02455c000',runtimeProgramId:'040094b02455c000',storage:4,
  contentId:'ab'.repeat(16),contentPath:'@UserContent://registered/base.nca',attributes:1,programIndex:0};
 const args={title:source.runtimeProgramId,storage:4,attributes:1,source,exactSource:true};
 const handles=new Set(),calls=[];let location=previous,readback,selectedPath,codeCalls=0,filenameBuffer;
 const attr=Buffer.alloc(16);attr[0]=1;
 const a={run:'/test/run',live:{session:'owned'},s:{base:2**32,handles,
  async write(address,bytes){assert.equal(address,this.base+0x4000);filenameBuffer=Buffer.from(bytes);},
  async readOwned(){return Buffer.from(readback);},
  async close(h){calls.push('close:'+h);handles.delete(h);},
  async ipc(label,h,command){calls.push(label);
   if(label==='Open selected game CodeFS'){
    codeCalls++;if(codeCalls===1&&initialResult)return {result:initialResult};
    if(codeCalls>1&&retryResult)return {result:retryResult};
    handles.add(10);return {result:0,handle:10};
   }
   if(label==='Open registered patch resolver'){assert.equal(command,1);handles.add(9);return {result:0,handle:9};}
   if(label==='Remove owned patch location'){if(restoreFails)throw Error('resolver removal failed');location=null;return {result:0};}
   assert.fail('Unexpected IPC '+label);
  }},service:async name=>{assert.equal(name,'lr');return 20;},domain:{
   wire:{control:()=>Buffer.alloc(4)},oneHandle:r=>{handles.add(r.handle);return r.handle;},
   async send(s,label,h,input){calls.push(label);
    if(label==='Clone held loader root for game CodeFS')return {result:0,handle:8};
    if(label==='Resolve selected update location'){
     if(!location)return {result:0x408};
     readback=Buffer.alloc(0x300);
     const value=selectionMismatch&&location.contentPath===source.contentPath?'@UserContent://registered/wrong.nca':location.contentPath;
     readback.write(value);return {result:0,data:Buffer.from(location.attributes,'hex')};
    }
    if(label==='Register owned patch location'||label==='Restore previous program location'){
     if(label.startsWith('Restore')&&restoreFails)throw Error('resolver restoration failed');
     location={contentPath:filenameBuffer.toString('utf8',0,filenameBuffer.indexOf(0)),attributes:input.subarray(48,64).toString('hex')};
     if(label.startsWith('Register'))selectedPath=location.contentPath;
     return {result:0};
    }
    assert.fail('Unexpected send '+label);
   }
  }};
 return {args,calls,handles,open:()=>loaded.exports.createProgramMounts(a).openCode(args),
  state:()=>({location,selectedPath,codeCalls})};
}
test('Base CodeFS retries the exact selected NCA after the observed signature failure and removes its temporary route',async()=>{
 const f=fixture();assert.equal(await f.open(),10);
 assert.deepEqual(f.state(),{location:null,selectedPath:f.args.source.contentPath,codeCalls:2});
 assert.equal(f.args.source.codeFsRoute,'verified-selected-base-path');
 assert.equal(f.handles.has(9),false);assert.equal(f.handles.has(10),true);
 assert.ok(f.calls.indexOf('Register owned patch location')<f.calls.lastIndexOf('Open selected game CodeFS'));
});
test('a previous resolver entry is restored and read back after a successful Base retry',async()=>{
 const previous={contentPath:'@UserContent://registered/update.nca',attributes:'01'+'00'.repeat(15)};
 const f=fixture({previous});assert.equal(await f.open(),10);assert.deepEqual(f.state().location,previous);
 assert.ok(f.calls.includes('Restore previous program location'));
});
test('a failed exact Base retry retains both results and restores resolver state',async()=>{
 const f=fixture({retryResult:0xa1e44802});await assert.rejects(f.open(),error=>{
  assert.equal(error.codeFsDiagnostic.initialResult.canonical,0x244802);
  assert.equal(error.codeFsDiagnostic.retryResult.canonical,0x244802);
  assert.equal(error.codeFsDiagnostic.contentPath,f.args.source.contentPath);return true;
 });assert.equal(f.state().location,null);assert.equal(f.handles.has(9),false);
});
test('resolver readback mismatch prevents the retry from opening a different NCA',async()=>{
 const f=fixture({selectionMismatch:true});await assert.rejects(f.open(),/resolver readback differs/);
 assert.equal(f.state().codeCalls,1);assert.equal(f.state().location,null);
});
test('unverified route cleanup blocks recovery even when CodeFS opened',async()=>{
 const f=fixture({restoreFails:true});await assert.rejects(f.open(),error=>error.cleanupBlocked===true);
 assert.equal(f.handles.has(10),true);assert.equal(f.state().location.contentPath,f.args.source.contentPath);
});
test('a working normal Base mount never changes any resolver',async()=>{
 const f=fixture({initialResult:0});assert.equal(await f.open(),10);assert.equal(f.state().codeCalls,1);
 assert.equal(f.calls.includes('Open registered patch resolver'),false);
});
test('other errors and non-Base callers never enter the new retry path',async()=>{
 const other=fixture({initialResult:0x320002});await assert.rejects(other.open());
 assert.equal(other.calls.includes('Open registered patch resolver'),false);
 const system=fixture();system.args.exactSource=false;await assert.rejects(system.open());
 assert.equal(system.calls.includes('Open registered patch resolver'),false);
});
