'use strict';
// Navigation rows are private UI entries, never title IDs passed to the exporter.
function views(entries){
 if(!Array.isArray(entries)||entries.length<1||entries.length>1000)throw Error('Invalid OunceCake title inventory');
 const system=entries.filter(entry=>['system-program','system-data'].includes(entry.kind));
 const root=entries.filter(entry=>!['system-program','system-data'].includes(entry.kind));
 if(system.length)root.push({name:'[Folder] System Files ('+system.length+')',navigation:'system'});
 return {root,system:[{name:'[..] Back',navigation:'root'},...system]};
}
module.exports={views};
