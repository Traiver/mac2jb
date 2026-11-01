'use strict';
// Cooperative deadline: never race a live native operation against resource cleanup.
const DEFAULT_TIMEOUT_MS=120000;
function timedOut(){return Object.assign(Error('Preparation timed out. Choose X for raw NCAs or another title.'),{code:'PREPARATION_TIMEOUT'});}
async function runPreparation(operation,{timeoutMs=DEFAULT_TIMEOUT_MS,shouldStop=()=>false,onProgress=()=>{},progressMs=10000}={}){
 if(!Number.isFinite(timeoutMs)||timeoutMs<=0)throw Error('Invalid preparation deadline');
 const started=Date.now(),deadline=started+timeoutMs;
 const notify=message=>{try{onProgress(message);}catch{}};
 let expired=false;
 const cancelled=()=>{expired ||= Date.now()>=deadline;return expired||shouldStop();};
 const timer=setTimeout(()=>{expired=true;notify('Preparation limit reached; waiting for the current console operation to return before cleanup.');},timeoutMs);
 const progress=setInterval(()=>{if(!expired)notify('Preparing export: '+Math.floor((Date.now()-started)/1000)+' seconds.');},progressMs);
 timer.unref?.();progress.unref?.();
 try{
  // Await settlement even after the deadline: an abandoned request may still own native resources.
  const result=await operation(cancelled);
  if(cancelled()&&expired)throw timedOut();
  return result;
 }catch(error){
  if((expired||Date.now()>=deadline)&&error?.code==='FTP_CANCELLED'&&!error.cleanupBlocked){const failure=timedOut();failure.cause=error;throw failure;}
  throw error;
 }finally{clearTimeout(timer);clearInterval(progress);}
}
const blocked=error=>Boolean(error?.cleanupBlocked||error?.errors?.some(blocked));
function canRawFallback(error){
 if(!error||blocked(error)||error instanceof AggregateError)return false;
 return ['MISSING_ELICENSE','ELICENSE_UNUSABLE','GAME_ORIGINAL_CONTENT_REQUIRED'].includes(error.code)||
  [0x7d802,0x1491,0x691].includes(error.nativeResult?.canonical)||canRawFallback(error.cause);
}
module.exports={runPreparation,canRawFallback,DEFAULT_TIMEOUT_MS};
