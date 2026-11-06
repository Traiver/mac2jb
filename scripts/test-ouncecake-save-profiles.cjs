'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const profiles=require('../integrations/mintbrew-ouncecake/save-profiles.cjs');
const saves=require('../integrations/mintbrew-ouncecake/saves.cjs');
const uid='00112233445566778899aabbccddeeff',other='ffeeddccbbaa99887766554433221100',zero='0'.repeat(32);
function base(id,name){const bytes=Buffer.alloc(56);Buffer.from(id,'hex').copy(bytes);Buffer.from(name).copy(bytes,24,0,32);return bytes;}
function fixture({names={[uid]:'Traiver',[other]:'テスト'},badUID=false,profileId,missing,denied,closeError=false,transportError=false}={}){
 let next=100;const handles=new Map(),calls=[],closed=[];
 const s={handles:new Set(),async openService(name){assert.equal(name,'acc:u0');s.handles.add(10);return 10;},
  async ipc(label,handle,cmd,input,options){calls.push({cmd,input,options});
   if(transportError)throw Error('Native request timed out');
   if(cmd===140)return {result:0};
   if(cmd===1&&handle===10)return {result:0,data:Buffer.from([input.toString('hex')===missing?0:1])};
   if(cmd===5){const id=input.toString('hex');if(denied===id)return {result:0x320002};const h=next++;handles.set(h,id);s.handles.add(h);return {result:0,moves:[h]};}
   assert.equal(cmd,1);return {result:0,data:base(badUID?zero:profileId||handles.get(handle),names[handles.get(handle)]||'')};
  },async close(handle){if(closeError)throw Error('Profile close failed');s.handles.delete(handle);closed.push(handle);}};
 return {attachment:{s,domain:{oneHandle:r=>r.moves[0]}},calls,closed};
}
const archive=(id=uid)=>({uid:id,titleId:'0400123456780000',id:'1',space:1,type:1,rank:0,index:0});
test('profile names match exact raw UIDs, preserve Unicode and query each account only once',async()=>{
 const f=fixture(),archives=[archive(),{...archive(),type:5},archive(other),archive(zero)];
 const result=await profiles.decorate({...f,archives});
 assert.equal(result[0].userName,'Traiver');assert.equal(result[1].userName,'Traiver');assert.equal(result[2].userName,'テスト');
 assert.equal(result[3].userName,undefined);assert.deepEqual(result.map(a=>a.uid),archives.map(a=>a.uid));
 assert.equal(f.calls.filter(c=>c.cmd===5).length,2);assert.deepEqual(f.calls.filter(c=>c.cmd===5).map(c=>c.input.toString('hex')),[uid,other]);
 assert.equal(f.calls[0].options.pid,true);assert.equal(f.attachment.s.handles.size,0);
 assert.match(saves.label(result[0]),/^Traiver \/ Account/);assert.match(saves.label(result[3]),/^Shared \/ Account/);
});
test('duplicate names remain distinguishable and missing accounts do not hide other names',async()=>{
 const dup=fixture({names:{[uid]:'Player',[other]:'Player'}});
 const rows=await profiles.decorate({...dup,archives:[archive(),archive(other)]});
 assert.match(saves.label(rows[0]),new RegExp(uid));assert.match(saves.label(rows[1]),new RegExp(other));
 const missing=fixture({denied:uid});const result=await profiles.decorate({...missing,archives:[archive(),archive(other)]});
 assert.equal(result[0].userName,undefined);assert.equal(result[1].userName,'テスト');assert.equal(missing.attachment.s.handles.size,0);
});
test('invalid profile IDs, invalid UTF-8 and control characters never produce a guessed profile name',async()=>{
 const f=fixture({badUID:true});const result=await profiles.decorate({...f,archives:[archive()]});
 assert.equal(result[0].userName,undefined);assert.match(saves.label(result[0]),new RegExp(uid));
 assert.equal(profiles.nickname(base(uid,'bad\nname'),uid),undefined);
 const corrupt=base(uid,'valid');corrupt[24]=255;assert.equal(profiles.nickname(corrupt,uid),undefined);
 assert.equal(profiles.nickname(Buffer.alloc(20),uid),undefined);
});
test('native profile ID aliases preserve the exact save UID and require account existence',async()=>{
 const profileId='11223344556677889900aabbccddeeff',f=fixture({profileId});
 const result=await profiles.decorate({...f,archives:[archive()]});
 assert.equal(result[0].uid,uid);assert.equal(result[0].userName,'Traiver');assert.equal(result[0].profileId,profileId);
 const absent=fixture({missing:uid});const missing=await profiles.decorate({...absent,archives:[archive()]});
 assert.equal(missing[0].userName,undefined);assert.equal(absent.calls.filter(c=>c.cmd===5).length,0);
});
test('shared-only archives do not open account services',async()=>{
 const f=fixture();await profiles.decorate({...f,archives:[archive(zero)]});assert.equal(f.calls.length,0);assert.equal(f.closed.length,0);
});
test('profile cancellation closes the account reader and transport errors propagate',async()=>{
 const f=fixture();let checks=0;
 await assert.rejects(profiles.decorate({...f,archives:[archive()],shouldStop:()=>++checks>2}),{code:'FTP_CANCELLED'});
 assert.equal(f.attachment.s.handles.size,0);
 const broken=fixture({transportError:true});await assert.rejects(profiles.decorate({...broken,archives:[archive()]}),/Native request timed out/);
 assert.equal(broken.attachment.s.handles.size,0);
});
test('unverified profile cleanup is fatal and never becomes a successful UID fallback',async()=>{
 const f=fixture({closeError:true});await assert.rejects(profiles.decorate({...f,archives:[archive()]}),e=>e.errors?.some(x=>x.cleanupBlocked)||e.cleanupBlocked===true);
 assert.ok(f.attachment.s.handles.size>0);
});
