'use strict';
// Serve a completed local backup. Network requests never touch the console/RPC.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const os=require('node:os'),crypto=require('node:crypto'),net=require('node:net');
const {safeName,hashFile}=require('./saves.cjs');
const check=(v,m)=>{if(!v)throw Object.assign(Error(m),{code:'SAVE_EXPORT_FAILED'});};
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const encode=value=>value.split('/').map(encodeURIComponent).join('/');
function hostAddress(switchAddress,interfaces=os.networkInterfaces()){
 check(net.isIPv4(switchAddress),'Invalid Switch address for save download');
 const number=ip=>ip.split('.').reduce((v,n)=>(v<<8)|Number(n),0);
 const candidates=Object.values(interfaces).flat().filter(a=>!a.internal&&a.family==='IPv4'&&
  net.isIPv4(a.address)&&net.isIPv4(a.netmask)&&
  (number(a.address)&number(a.netmask))===(number(switchAddress)&number(a.netmask)));
 check(candidates.length>0,'No Mac IPv4 address on the Switch network');
 return candidates[0].address;
}
async function start({folder,manifest,name,address,port=0}){
 check(net.isIPv4(address)&&!address.startsWith('0.')&&safeName(name),'Invalid save download endpoint');
 check(manifest?.format==='mac2jb.save-backup'&&manifest.partial===false&&
  Array.isArray(manifest.entries)&&Array.isArray(manifest.directories),'Incomplete save backup');
 const root=await fs.realpath(folder),token=crypto.randomBytes(8).toString('hex'),base='/'+token+'/';
 const nodes=new Map([['',{directory:true}], [name,{directory:true}], [name+'/files',{directory:true}]]);
 const add=(key,node)=>{check(!nodes.has(key),'Repeated save download path');nodes.set(key,node);};
 const validate=p=>{check(typeof p==='string'&&p.split('/').every(safeName),'Invalid backup path');};
 for(const relative of manifest.directories){validate(relative);add(name+'/files/'+relative,{directory:true});}
 async function file(relative,key,expected){
  const target=path.join(root,relative),info=await fs.lstat(target);
  check(info.isFile()&&!info.isSymbolicLink()&&await fs.realpath(target)===target,'Unsafe save backup file');
  if(expected)check(info.size===expected.size&&await hashFile(target)===expected.sha256,'Save backup changed before download');
  add(key,{target,size:info.size,sha256:expected?.sha256});
 }
 for(const entry of manifest.entries){validate(entry.path);await file('files/'+entry.path,name+'/files/'+entry.path,entry);}
 const diskManifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8'));
 check(JSON.stringify(diskManifest)===JSON.stringify(manifest),'Save backup manifest changed before download');
 await file('manifest.json',name+'/manifest.json');
 const sockets=new Set(),active=new Set();let closing=false;
 const server=http.createServer(async(req,res)=>{
  let finished;const operation=new Promise(resolve=>{finished=resolve;});active.add(operation);req.resume();
  try{
   if(closing){res.writeHead(503);res.end();return;}
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
   check(req.url?.length<16384,'Invalid request');
   const raw=req.url.split('?')[0];
   if(!raw.startsWith(base)){res.writeHead(404);res.end();return;}
   let key=decodeURIComponent(raw.slice(base.length));
   if(key.endsWith('/'))key=key.slice(0,-1);
   if(key&&!key.split('/').every(safeName)){res.writeHead(400);res.end();return;}
   const node=nodes.get(key);if(!node){res.writeHead(404);res.end();return;}
   if(req.method==='OPTIONS'){res.writeHead(200,{Allow:'OPTIONS, GET, HEAD, PROPFIND',DAV:'1'});res.end();return;}
   if(req.method==='PROPFIND'){
    const depth=req.headers.depth??'infinity';
    if(!['0','1','infinity'].includes(depth)){res.writeHead(400);res.end();return;}
    const prefix=key?key+'/':'';
    const list=[...nodes].filter(([k])=>k===key||node.directory&&depth!=='0'&&k.startsWith(prefix)&&
     (depth==='infinity'||!k.slice(prefix.length).includes('/')));
    const xml='<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:">'+list.map(([k,n])=>
     '<d:response><d:href>'+escape(base+encode(k)+(n.directory&&k?'/':''))+'</d:href><d:propstat><d:prop>'+
     '<d:displayname>'+escape(k.split('/').pop()||'Save backup')+'</d:displayname><d:resourcetype>'+
     (n.directory?'<d:collection/>':'')+'</d:resourcetype><d:getcontentlength>'+(n.size||0)+
     '</d:getcontentlength></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>').join('')+'</d:multistatus>';
    res.writeHead(207,{'Content-Type':'application/xml; charset=utf-8'});res.end(xml);return;
   }
   if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'OPTIONS, GET, HEAD, PROPFIND'});res.end();return;}
   if(node.directory){
    // Always use absolute links, including when a client omits the trailing slash.
    const prefix=key?key+'/':'',rows=[...nodes].filter(([k])=>k!==key&&k.startsWith(prefix)&&!k.slice(prefix.length).includes('/'));
    const html='<!doctype html><meta charset="utf-8"><title>Save backup</title><h1>'+escape(key||'Save backup')+'</h1><ul>'+rows.map(([k,n])=>
     '<li><a href="'+escape(base+encode(k)+(n.directory?'/':''))+'">'+escape(k.slice(prefix.length))+(n.directory?'/':'')+'</a></li>').join('')+'</ul>';
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Length':Buffer.byteLength(html)});res.end(req.method==='HEAD'?undefined:html);return;
   }
   let start=0,end=node.size-1,partial=false;
   if(req.headers.range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    if(match&&(match[1]||match[2])){
     if(match[1]){start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}
     else start=Math.max(0,node.size-Number(match[2]));
     partial=true;
    }
    if(!partial||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=node.size){res.writeHead(416,{'Content-Range':'bytes */'+node.size});res.end();return;}
   }
   check(await fs.realpath(node.target)===node.target,'Save backup path changed');
   const handle=await fs.open(node.target,require('node:fs').constants.O_RDONLY|require('node:fs').constants.O_NOFOLLOW);
   try{
    const info=await handle.stat();check(info.isFile()&&info.size===node.size,'Save backup changed during download');
    if(res.destroyed)return;
    const headers={'Content-Type':'application/octet-stream','Content-Length':node.size?end-start+1:0,'Accept-Ranges':'bytes'};
    if(partial)headers['Content-Range']='bytes '+start+'-'+end+'/'+node.size;
    res.writeHead(partial?206:200,headers);
    if(req.method==='HEAD'||node.size===0){res.end();return;}
    const stream=handle.createReadStream({start,end,autoClose:false});
    await new Promise((resolve,reject)=>{res.once('close',()=>{stream.destroy();resolve();});stream.once('error',reject);stream.pipe(res);});
   }finally{await handle.close();}
  }catch(error){if(!res.headersSent)res.writeHead(error instanceof URIError?400:500);res.end();}
  finally{active.delete(operation);finished();}
 });
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.requestTimeout=30000;server.headersTimeout=15000;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,address,()=>{server.off('error',reject);resolve();});});
 return {kind:'local-save',url:'http://'+address+':'+server.address().port+base,
  async close(){if(!closing){closing=(async()=>{
   const stopped=new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
   const connections=[...sockets].map(socket=>new Promise(resolve=>{socket.once('close',resolve);socket.destroy();}));
   await Promise.all([stopped,...connections]);await Promise.all([...active]);
  })();}await closing;return {localStopped:!server.listening,connectionsClosed:sockets.size===0&&active.size===0};}};
}
module.exports={start,hostAddress};
