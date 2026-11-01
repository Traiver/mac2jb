const test=require('node:test');
const assert=require('node:assert/strict');
const {dispatchServiceRequest}=require('./app-runtime.cjs');

test('A selects a game and B closes FTP before another selection',async()=>{
 const memory=Buffer.alloc(1024),events=[];
 const rpc={write:async(address,data)=>{
  assert.equal(address,1012);
  assert.equal(data.length,4);
  data.copy(memory,address);
 }};
 const service={select:async index=>events.push(['select',index]),back:async()=>events.push(['back'])};
 memory.writeUInt32LE(3,1012);
 assert.equal(await dispatchServiceRequest(rpc,0,service,memory.readUInt32LE(1012)),true);
 assert.equal(memory.readUInt32LE(1012),0);
 memory.writeUInt32LE(0xffffffff,1012);
 assert.equal(await dispatchServiceRequest(rpc,0,service,memory.readUInt32LE(1012)),true);
 assert.equal(memory.readUInt32LE(1012),0);
 memory.writeUInt32LE(1,1012);
 assert.equal(await dispatchServiceRequest(rpc,0,service,memory.readUInt32LE(1012)),true);
 assert.deepEqual(events,[['select',2],['back'],['select',0]]);
 assert.equal(await dispatchServiceRequest(rpc,0,service,0),false);
});

test('X dispatches raw selection separately from A and Back',async()=>{
 const calls=[];const rpc={write:async()=>{}};const service={select:()=>assert.fail('raw must not select decrypted view'),selectRaw:async index=>calls.push(index)};
 await dispatchServiceRequest(rpc,0,service,0x80000003);assert.deepEqual(calls,[2]);
 await assert.rejects(dispatchServiceRequest(rpc,0,{select(){}},0x80000001),/cannot export raw/);
});
