'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const protocol=require('../vendor/OunceCake/engine/protocol.cjs');
function program(context){
 const filename=path.resolve(__dirname,'../vendor/OunceCake/engine/program.cjs');
 const loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=module.paths;
 loaded.require=name=>name==='node:fs/promises'?{async readFile(file){assert.ok(file.endsWith('owned-loader-root-copy.json'));return JSON.stringify({copy:{handle:7}});}}:
  name==='./fs-context.cjs'&&context?context:module.require(Module._resolveFilename(name,loaded));
 loaded._compile(fs.readFileSync(filename,'utf8'),filename);
 return loaded.exports;
}
function fixture({initialResult=0xa1e44802,retryResult=0,previous=null,selectionMismatch=false,restoreFails=false}={}){
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
 return {args,calls,handles,open:()=>program().createProgramMounts(a).openCode(args),
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

function indexedFixture({mountError=false,restoreError=false}={}){
 const title='010049900f546000', programId='010049900f546002';
 const original={programIndex:2,runtimeProgramId:programId,storage:2,attributes:1,contentPath:'@GameCard://base.nca'};
 const source={programIndex:2,runtimeProgramId:programId,storage:4,attributes:2,contentPath:'@UserContent://patch.nca',selection:'update'};
 const existing={contentPath:'@GameCard://previous.nca',attributes:'01'+'00'.repeat(15)};
 const paths=new Map([['9:0',existing],['9:16',null],['11:0',null]]);
 const handles=new Set(),calls=[];
 let buffer,readback;
 const a={run:'/test/run',live:{session:'owned'},s:{base:2**32,handles,
  async write(address,bytes){assert.equal(address,this.base+0x4000);buffer=Buffer.from(bytes);},
  async readOwned(){return readback;},
  async close(h){handles.delete(h);},
  async ipc(label,h,command,input){
   calls.push(label);
   if(label==='Open registered patch resolver')return {result:0,handle:11};
   if(label==='Open indexed Base location resolver'){assert.deepEqual(input,Buffer.from([2]));return {result:0,handle:9};}
   if(label==='Remove temporary indexed Base location'){
    assert.equal(h,9);assert.equal(input.readBigUInt64LE(),BigInt('0x'+programId));
    paths.set('9:'+(command===12?0:16),null);return {result:0};
   }
   if(label==='Remove owned patch location'){paths.set('11:0',null);return {result:0};}
   if(label==='Open selected game CodeFS'){
    assert.equal(paths.get('9:0').contentPath,original.contentPath);
    assert.equal(paths.get('9:16').contentPath,original.contentPath);
    assert.equal(paths.get('11:0').contentPath,source.contentPath);
    assert.equal(input[1],2);
    return mountError?{result:0x320002}:{result:0,handle:10};
   }
   assert.fail('Unexpected IPC '+label);
  }},service:async name=>{assert.equal(name,'lr');return 20;},domain:{
   wire:{control:()=>Buffer.alloc(4)},oneHandle:r=>{handles.add(r.handle);return r.handle;},
   async send(s,label,h,packet){
    calls.push(label);
    if(label==='Clone held loader root for game CodeFS')return {result:0,handle:8};
    assert.equal(packet.readBigUInt64LE(32),BigInt('0x'+programId));
    const command=packet.readUInt32LE(24);
    if(label==='Resolve selected update location'){
     const value=paths.get(h+':'+command);
     if(!value)return {result:0x408};
     readback=Buffer.alloc(0x300);readback.write(value.contentPath);
     return {result:0,data:Buffer.from(value.attributes,'hex')};
    }
    const route=h+':'+(command===18?16:0);
    if(label==='Restore indexed Base location'&&restoreError)return {result:0};
    paths.set(route,{contentPath:buffer.toString('utf8',0,buffer.indexOf(0)),attributes:packet.subarray(48,64).toString('hex')});
    return {result:0};
   }
  }};
 const mounts=program({async withProgramIndexMap(options){
  assert.equal(options.runtimeProgramId,programId);assert.equal(options.programIndex,2);return options.operation();
 }}).createProgramMounts(a);
 return {paths,calls,handles,existing,open:(base=original)=>mounts.openUpdate({title,source,originalSource:base,section:'exefs'})};
}
test('indexed update uses the matching Base from its own storage and restores the normal and debug paths',async()=>{
 const f=indexedFixture();assert.equal(await f.open(),10);
 assert.deepEqual([...f.paths.values()],[f.existing,null,null]);
 assert.ok(!f.handles.has(9)&&!f.handles.has(11));
});
test('an indexed update rejects Base index zero and verifies restoration after mount failure',async()=>{
 const f=indexedFixture();await assert.rejects(f.open({programIndex:0}),/no matching Base/);assert.deepEqual(f.calls,[]);
 const failing=indexedFixture({mountError:true});await assert.rejects(failing.open(),e=>e.nativeResult.canonical===0x320002);
 assert.deepEqual([...failing.paths.values()],[failing.existing,null,null]);
 const damaged=indexedFixture({restoreError:true});await assert.rejects(damaged.open(),e=>e.cleanupBlocked===true);
});
