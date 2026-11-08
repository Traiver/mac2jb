const MAGIC=0x31435a4f;
// One extra navigation row for Back when all 1000 titles are system entries.
const MAX_GAMES=1001;
const HEADER_BYTES=4096;
const TITLE_TILE_INDEX=MAX_GAMES;
const TILE_WIDTH=1408;
const TILE_HEIGHT=32;
const TILE_BYTES=TILE_WIDTH*TILE_HEIGHT/4;
const STORAGE_BYTES=16*1024*1024;
const STATES=Object.freeze({reading:0,catalog:1,preparing:2,running:3,error:4,closing:5,importing:6,saveTransfer:7});

function header(state,count=0,message='',generation=0,parent=false,focus=0,title=false,saves=0,notice=''){
 if(![0,1,2].includes(saves))throw Error('Invalid OunceCake save menu mode');
 if(!Number.isInteger(generation)||generation<0||generation>0xffffffff||typeof parent!=='boolean'||typeof title!=='boolean'||
  !Number.isInteger(focus)||focus<0||focus>MAX_GAMES)throw Error('Invalid OunceCake catalog navigation');
 if(!Object.values(STATES).includes(state)||!Number.isInteger(count)||count<0||count>MAX_GAMES)
  throw Error('Invalid OunceCake display state');
 const line=text=>Buffer.from(String(text).replace(/[^\x20-\x7e]/g,'?').slice(0,76),'ascii');
 const ascii=line(message),secondary=line(notice);
 const data=Buffer.alloc(HEADER_BYTES);
 data.writeUInt32LE(MAGIC,0);data.writeUInt32LE(state,4);data.writeUInt32LE(count,8);
 data.writeUInt32LE(generation,12);data.writeUInt32LE(parent?1:0,20);data.writeUInt32LE(focus,24);
 data.writeUInt32LE(title?1:0,28);
 data.writeUInt32LE(saves,32);
 data.writeUInt32LE(ascii.length,16);ascii.copy(data,128);
 data.writeUInt32LE(secondary.length,36);secondary.copy(data,256);
 return data;
}
module.exports={TITLE_TILE_INDEX,MAGIC,MAX_GAMES,HEADER_BYTES,TILE_WIDTH,TILE_HEIGHT,TILE_BYTES,STORAGE_BYTES,STATES,header};
