'use strict';
// Local preparation only. This module never connects to the console.
const fs=require('node:fs/promises'),sync=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const saves=require('./saves.cjs');
const check=(v,m)=>{if(!v)throw Object.assign(Error(m),{code:'SAVE_IMPORT_INVALID'});};
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const validPath=p=>typeof p==='string'&&p.length>0&&Buffer.byteLength('/'+p)<0x301&&p.split('/').length<=32&&p.split('/').every(saves.safeName);
const supported=a=>{saves.validateArchive(a);check(saves.isGameSave(a)&&[1,3].includes(a.type)&&a.rank===0&&a.index===0,'Import supports primary Account and Device archives at index 0. BCAT remains export-only.');return a;};
async function regular(file,limit=16*1024*1024){
 const h=await fs.open(file,sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW);
 try{const st=await h.stat();check(st.isFile()&&st.size<=limit,'Invalid or oversized import metadata');return await h.readFile();}finally{await h.close();}
}
const json=async file=>JSON.parse(await regular(file));
async function atomic(file,value){const temp=file+'.'+crypto.randomBytes(8).toString('hex');try{await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}}
async function requestAt(folder){
 check(path.isAbsolute(folder)&&await fs.realpath(folder)===folder,'Invalid import request directory');
 const r=await json(path.join(folder,'request.json'));
 check(r.format==='mac2jb.save-import-request'&&r.version===1&&/^[a-f0-9]{48}$/.test(r.nonce)&&
  path.basename(folder)==='request-'+r.nonce&&typeof r.sourceSession==='string'&&r.sourceSession.length>0&&
  Number.isSafeInteger(r.expires)&&Date.now()<r.expires,'The import request expired or belongs to another session');
 supported(r.archive);return r;
}
async function create({directory,archive,titleName,sourceSession,transport}){
 supported(archive);const nonce=crypto.randomBytes(24).toString('hex');
 await fs.mkdir(directory,{recursive:true,mode:0o700});
 const folder=path.join(await fs.realpath(directory),'request-'+nonce);await fs.mkdir(folder,{mode:0o700});
 const request={format:'mac2jb.save-import-request',version:1,nonce,sourceSession,archive,titleName,
  ownerPid:process.pid,transport,expires:Date.now()+15*60*1000};
 await atomic(path.join(folder,'request.json'),request);return {folder,request};
}
async function stage({folder,source}){
 const request=await requestAt(folder);
 check(!await fs.stat(path.join(folder,'command.json')).catch(e=>{if(e.code!=='ENOENT')throw e;}),'This import was already submitted');
 const root=await fs.realpath(source),manifest=await json(path.join(root,'manifest.json'));
 check(manifest.format==='mac2jb.save-backup'&&manifest.version===1&&manifest.partial===false&&manifest.readOnly===true&&
  manifest.titleId===request.archive.titleId&&Array.isArray(manifest.entries)&&Array.isArray(manifest.directories)&&
  manifest.files===manifest.entries.length&&manifest.entries.length<=65536,'Choose one complete OunceCake save backup containing manifest.json and files/');
 saves.validateArchive(manifest.selection);
 check(saves.identity(manifest.selection)===saves.identity(request.archive),'The backup belongs to a different title, user or save archive');
 check(manifest.entries.every(e=>validPath(e.path)&&Number.isSafeInteger(e.size)&&e.size>=0&&/^[a-f0-9]{64}$/.test(e.sha256))&&
  new Set(manifest.entries.map(e=>e.path)).size===manifest.entries.length&&manifest.directories.every(validPath),'Invalid source backup manifest');
 const originalPaths=new Set([...manifest.directories,...manifest.entries.map(e=>e.path)]);
 const localMetadata=name=>['.ds_store','thumbs.db','desktop.ini','__macosx'].includes(name.toLowerCase())||name.startsWith('._');
 let sourceFiles=path.join(root,'files');
 check(await fs.realpath(sourceFiles)===sourceFiles,'The files directory must not be a symbolic link');
 if(request.transport==='webdav'&&!originalPaths.has('files')){
  const roots=(await fs.readdir(sourceFiles,{withFileTypes:true})).filter(entry=>!localMetadata(entry.name)||originalPaths.has(entry.name));
  if(roots.some(entry=>entry.name==='files'&&entry.isDirectory())){
   check(roots.length===1,'Upload the files folder by itself, or upload its contents directly.');
   sourceFiles=path.join(sourceFiles,'files');
  }
 }
 const staging=await fs.mkdtemp(path.join(folder,'stage-'));await fs.mkdir(path.join(staging,'files'),{mode:0o700});
 const entries=[],directories=[];let total=0,items=0,complete=false;
 try{
  async function walk(relative=''){
   const from=path.join(sourceFiles,relative),before=await fs.lstat(from);
   check(before.isDirectory()&&!before.isSymbolicLink()&&await fs.realpath(from)===from,'Source directories must not be links');
   for(const entry of await fs.readdir(from,{withFileTypes:true})){
    const name=relative?relative+'/'+entry.name:entry.name;
    // Opening a downloaded backup in Finder/Explorer must not add OS metadata
    // to the console. Preserve such names if the game originally owned them.
    if(localMetadata(entry.name)&&!originalPaths.has(name))continue;
    check(validPath(name)&&++items<=65536,'Unsafe or excessive import paths');
    const input=path.join(sourceFiles,name),output=path.join(staging,'files',name);
    if(entry.isDirectory()){directories.push(name);await fs.mkdir(output,{mode:0o700});await walk(name);continue;}
    check(entry.isFile()&&!entry.isSymbolicLink(),'Import sources must be regular files');
    const file=await fs.open(input,sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW),dest=await fs.open(output,'wx',0o600);
    const hash=crypto.createHash('sha256');let copied=0;
    try{
     const start=await file.stat();check(start.isFile()&&Number.isSafeInteger(total+start.size)&&total+start.size<=64*1024**3,'Import exceeds its size limit');
     for await(const bytes of file.createReadStream({autoClose:false})){
      hash.update(bytes);let offset=0;while(offset<bytes.length){const r=await dest.write(bytes,offset,bytes.length-offset);check(r.bytesWritten>0,'Could not stage save file');offset+=r.bytesWritten;}copied+=bytes.length;
     }
     const end=await file.stat();check(copied===start.size&&start.size===end.size&&start.mtimeMs===end.mtimeMs&&start.ctimeMs===end.ctimeMs,'Source changed during preparation; choose the folder again');
     await dest.sync();await dest.chmod(0o400);
    }finally{await Promise.allSettled([file.close(),dest.close()]);}
    const sha256=hash.digest('hex');check(await saves.hashFile(output)===sha256,'Staged checksum mismatch');
    entries.push({path:name,size:copied,sha256});total+=copied;
   }
   const after=await fs.lstat(from);check(before.ino===after.ino&&before.mtimeMs===after.mtimeMs,'Source directory changed during preparation');
  }
  await walk();check(entries.length>0,'The selected save contains no files to import');
  entries.sort((a,b)=>a.path.localeCompare(b.path));directories.sort();
  const plan={format:'mac2jb.save-import-plan',version:1,nonce:request.nonce,archive:request.archive,stage:path.basename(staging),entries,directories,files:entries.length,bytes:total};
  await requestAt(folder);
  const digest=sha(JSON.stringify(plan));await atomic(path.join(folder,'plan.json'),{...plan,digest});complete=true;
  return {digest,files:plan.files,bytes:plan.bytes,changed:entries.filter(e=>!manifest.entries.some(old=>old.path===e.path&&old.size===e.size&&old.sha256===e.sha256)).length};
 }finally{if(!complete)await fs.rm(staging,{recursive:true,force:true});}
}
async function planAt(folder,digest){
 const request=await requestAt(folder),plan=await json(path.join(folder,'plan.json'));
 const {digest:sealed,...body}=plan;
 check(sealed===digest&&/^[a-f0-9]{64}$/.test(digest)&&sha(JSON.stringify(body))===digest&&
  plan.format==='mac2jb.save-import-plan'&&plan.version===1&&plan.nonce===request.nonce&&
  saves.identity(plan.archive)===saves.identity(request.archive)&&/^stage-[a-zA-Z0-9]+$/.test(plan.stage)&&
  Array.isArray(plan.entries)&&plan.entries.length>0&&plan.entries.length===plan.files&&plan.entries.length<=65536&&
  Array.isArray(plan.directories)&&plan.directories.every(validPath),'The prepared import changed; prepare it again');
 const stageRoot=path.join(folder,plan.stage,'files');check(await fs.realpath(stageRoot)===stageRoot,'Invalid staged files directory');
 for(const e of plan.entries){
  check(validPath(e.path)&&Number.isSafeInteger(e.size)&&e.size>=0&&/^[a-f0-9]{64}$/.test(e.sha256),'Invalid import entry');
  const file=path.join(stageRoot,e.path),st=await fs.lstat(file);
  check(st.isFile()&&!st.isSymbolicLink()&&await fs.realpath(file)===file&&st.size===e.size&&await saves.hashFile(file)===e.sha256,'Staged file changed: '+e.path);
 }
 check(new Set(plan.entries.map(e=>e.path)).size===plan.entries.length,'Duplicate import entries');
 return {...plan,stageRoot};
}
async function command(folder,action,digest){
 const r=await requestAt(folder);check(['confirm','cancel'].includes(action),'Invalid import action');
 if(action==='confirm')await planAt(folder,digest);
 const h=await fs.open(path.join(folder,'command.json'),'wx',0o600);
 try{await h.writeFile(JSON.stringify({action,nonce:r.nonce,digest}));await h.sync();}finally{await h.close();}
}
module.exports={create,requestAt,stage,planAt,command,regular,json,atomic,validPath,supported};
if(require.main===module)(async()=>{
 const [action,folder,arg]=process.argv.slice(2);
 const result=action==='stage'?await stage({folder,source:arg}):await command(folder,action,arg);
 process.stdout.write(JSON.stringify(result||{ok:true})+'\n');
})().catch(e=>{process.stderr.write(e.message+'\n');process.exitCode=1;});
