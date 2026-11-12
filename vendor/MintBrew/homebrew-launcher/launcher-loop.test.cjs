const test=require('node:test');
const assert=require('node:assert/strict');
const {serviceStartError,reuseOunceCakeFrame}=require('./launcher-loop.cjs');

test('idle MintBrew menu has no failed service to read',()=>{
 assert.equal(serviceStartError(undefined,null),null);
 assert.equal(serviceStartError(undefined,{service:undefined}),null);
});

test('only the active service receives its start failure',()=>{
 const service={},error=Error('stream start failed');
 const failure={service,error};
 assert.equal(serviceStartError(failure,{service}),error);
 assert.equal(serviceStartError(failure,{service:{}}),null);
 assert.equal(serviceStartError(failure,null),null);
});

test('OunceCake can reuse a joined frame only for a selection with the same app and input calls',()=>{
 const app={id:'ouncecake'},input=[{function:42,args:[1,2]}];
 assert.ok(reuseOunceCakeFrame(app,app,0xffffffff,structuredClone(input),input));
 assert.equal(reuseOunceCakeFrame(app,app,1,[{function:42,args:[1,3]}],input),false);
 assert.equal(reuseOunceCakeFrame(app,{...app},1,input,input),false);
 assert.equal(reuseOunceCakeFrame(app,app,0,input,input),false);
 const other={id:'hello-world'};
 assert.equal(reuseOunceCakeFrame(other,other,1,input,input),false);
});
