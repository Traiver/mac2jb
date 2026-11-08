'use strict';
// The DAV inbox stages files on the Mac independently of the export snapshot.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {validPath,atomic}=require('./save-import-files.cjs');
const MAX_BYTES=2*1024**3,MAX_ITEMS=4096;
const METHODS='OPTIONS, GET, HEAD, PROPFIND, PUT, MKCOL';
async function create({folder,manifest,prefix,maxBytes=MAX_BYTES}){
 const source=await fs.mkdtemp(path.join(await fs.realpath(folder),'inbox-')),files=path.join(source,'files');
 try{await fs.mkdir(files,{mode:0o700});await atomic(path.join(source,'manifest.json'),manifest);}
 catch(error){await fs.rm(source,{recursive:true,force:true});throw error;}
 const nodes=new Map([[prefix,{directory:true}]]),failed=new Set();
 let activeRequest,idle,sealed=false,bytes=0,count=0;
 const belongs=key=>key===prefix||key.startsWith(prefix+'/');
 async function mutate(req,res,key){
  const finish=status=>{res.writeHead(status);res.end();};
  if(sealed)return finish(403);
  if(activeRequest)return finish(423);
  const relative=key.slice(prefix.length+1),parent=key.slice(0,key.lastIndexOf('/')),old=nodes.get(key);
  if(!validPath(relative))return finish(400);
  if(!nodes.get(parent)?.directory)return finish(409);
  if(!old&&!failed.has(key)&&nodes.size+failed.size>MAX_ITEMS)return finish(507);
  const target=path.join(files,relative);
  activeRequest=req;let settle;idle=new Promise(resolve=>{settle=resolve;});
  let temp;
  try{
   // A case-insensitive or normalization-insensitive Mac volume can alias
   // different DAV paths. Never let a new name overwrite a staged sibling.
   if(!old&&await fs.lstat(target).catch(error=>{if(error.code!=='ENOENT')throw error;}))return finish(409);
   if(req.method==='MKCOL'){
    if(old)return finish(405);
    if(req.headers['transfer-encoding']||Number(req.headers['content-length']||0)!==0)return finish(415);
    await fs.mkdir(target,{mode:0o700});
    nodes.set(key,{directory:true});return finish(201);
   }
   if(old?.directory)return finish(405);
   // A failed replacement must be retried before a batch can be reviewed.
   failed.add(key);
   req.setTimeout(30000,()=>req.destroy());
   const remaining=maxBytes-bytes+(old?.size||0),length=req.headers['content-length'];
   if(req.headers['content-range']||(length===undefined&&!req.headers['transfer-encoding']))return finish(400);
   if(length!==undefined&&(!/^\d+$/.test(length)||Number(length)>remaining))return finish(413);
   temp=path.join(source,'part-'+crypto.randomBytes(12).toString('hex'));
   const h=await fs.open(temp,'wx',0o600);let size=0;
   try{
    // Keep backpressure and do not publish incomplete or oversized bodies.
    for await(const chunk of req.iterator({destroyOnReturn:false})){
     size+=chunk.length;
     if(size>remaining){res.setHeader('Connection','close');req.resume();return finish(413);}
     let offset=0;
     while(offset<chunk.length){
      const {bytesWritten}=await h.write(chunk,offset,chunk.length-offset);
      if(!bytesWritten)throw Error('Could not stage save upload');
      offset+=bytesWritten;
     }
    }
    if(!req.complete||(length!==undefined&&size!==Number(length)))return finish(400);
    await h.sync();
   }finally{await h.close();}
   if(sealed)return finish(403);
   await fs.rename(temp,target);temp=null;
   bytes=bytes-(old?.size||0)+size;if(!old)count++;
   nodes.set(key,{target,size});failed.delete(key);
   return finish(old?204:201);
  }finally{try{if(temp)await fs.rm(temp,{force:true});}finally{activeRequest=null;settle();}}
 }
 return {nodes,belongs,source,mutate,
  freeze(){
   if(activeRequest)throw Error('Wait for the WinSCP transfers to finish.');
   if(failed.size)throw Error('Retry failed uploads before reviewing.');
   if(!count)throw Error('Upload at least one save file first.');
   if(sealed)throw Error('The uploads are already under review.');
   sealed=true;return source;
  },
  async remove(){sealed=true;activeRequest?.destroy();await idle;await fs.rm(source,{recursive:true,force:true});}
 };
}
module.exports={create,METHODS};
