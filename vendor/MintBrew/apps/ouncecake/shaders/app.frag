#version 450
#extension GL_GOOGLE_include_directive : require
layout(location=0) out vec4 outColor;
#define STATE_ACCESS readonly
#include "abi.glsl"
#include "draw.glsl"
#include "text.glsl"
// Button masks are only needed by the unused navigation helper in this stage.
const uint HB_UP=8192u,HB_DOWN=32768u,HB_L=64u,HB_R=128u;
#include "navigation.glsl"
layout(set=0,binding=1,std430) readonly buffer OunceCakeData {uint words[];} payload;
const uint TILE_BASE=4096u,TILE_WIDTH=768u,TILE_HEIGHT=32u,TILE_BYTES=12288u;
float titlePixel(vec2 p,vec2 origin,uint index){
 ivec2 q=ivec2(floor(p-origin));
 if(any(lessThan(q,ivec2(0)))||q.x>=int(TILE_WIDTH)||q.y>=int(TILE_HEIGHT))return 0.0;
 uint address=TILE_BASE+index*TILE_BYTES+uint(q.y)*TILE_WIDTH/2u+uint(q.x)/2u;
 uint packed=(payload.words[address>>2u]>>((address&3u)*8u))&255u;
 return float((q.x&1)==0?packed>>4u:packed&15u)/15.0;
}
uint messageByte(uint index){
 uint address=128u+index;
 return (payload.words[address>>2u]>>((address&3u)*8u))&255u;
}
float asciiGlyph(vec2 p,vec2 origin,uint code){
 if(code<32u||code>127u)return 0.0;
 ivec2 q=ivec2(floor(p-origin));
 if(any(lessThan(q,ivec2(0)))||q.x>=int(ASCII_CELL_WIDTH)||q.y>=int(ASCII_CELL_HEIGHT))return 0.0;
 uint id=code-32u;
 uint address=(ASCII_ATLAS_Y+(id/16u)*ASCII_CELL_HEIGHT+uint(q.y))*1024u+
  (id%16u)*ASCII_CELL_WIDTH+uint(q.x);
 uint value=c.atlas[address>>2u];
 return float((value>>((address&3u)*8u))&255u)/255.0;
}
float messagePixel(vec2 p,vec2 origin){
 uint length=min(payload.words[4],76u);
 if(p.y<origin.y||p.y>=origin.y+float(ASCII_CELL_HEIGHT)||p.x<origin.x||p.x>=origin.x+float(length*ASCII_CELL_WIDTH))return 0.0;
 uint index=uint((p.x-origin.x)/float(ASCII_CELL_WIDTH));
 return asciiGlyph(p,origin+vec2(float(index*ASCII_CELL_WIDTH),0),messageByte(index));
}
void main(){
 vec2 p=gl_FragCoord.xy;
 const vec3 mist=vec3(.62,.80,.96),ink=vec3(.91,.96,1.0),muted=vec3(.64,.73,.84);
 vec3 col=mix(vec3(.025,.055,.095),vec3(.015,.03,.055),p.y/1080.0);
 float panel=box(p,vec2(960,540),vec2(800,490),30.0);
 col=mix(col,vec3(.055,.10,.16),fill(panel));
 col+=vec3(.55,.75,.95)*fill(panel)*pow(1.0-p.y/1080.0,3.0)*.035;
 col=mix(col,mist,line(panel,1.3)*.4);
 col=mix(col,ink,text(p,vec2(190,110),TEXT_TITLE));
 col=mix(col,muted,text(p,vec2(195,198),TEXT_SUBTITLE));
 uint status=payload.words[0]==0x31435a4fu?payload.words[1]:0u;
 if(status==1u){
  if(payload.words[4]>0u)col=mix(col,vec3(.99,.64,.57),messagePixel(p,vec2(195,270)));
  else col=mix(col,ink,text(p,vec2(195,260),payload.words[5]!=0u?TEXT_SYSTEM:TEXT_CHOOSE));
  uint count=min(payload.words[2],1001u),scroll=min(c.game.y,count>8u?count-8u:0u);
  for(uint i=0u;i<8u;i++){
   uint index=scroll+i;if(index>=count)break;
   float y=350.0+float(i)*75.0;
   float selected=index==c.game.x?1.0:0.0;
   float row=box(p,vec2(960,y),vec2(742,33),12.0);
   col=mix(col,vec3(.085,.16,.25),fill(row)*(.55+.4*selected));
   col=mix(col,mist,line(row,1.4)*selected);
   col+=vec3(.70,.85,1.0)*fill(row)*clamp((y+33.0-p.y)/66.0,0.0,1.0)*.018;
   col+=mist*exp(-max(row,0.0)/15.0)*selected*.035;
   col=mix(col,selected>0.5?mist:ink,titlePixel(p,vec2(240,y-16),index));
  }
  // Rail occupies the margin between the list cards and the panel edge.
  if(count>8u){
   const float top=318.0,height=590.0,x=1728.0;
   float thumbHeight=ounceThumbHeight(count,height);
   float thumbTop=top+ounceThumbOffset(count,scroll,height);
   float rail=box(p,vec2(x,top+height*.5),vec2(3.0,height*.5),3.0);
   float thumb=box(p,vec2(x,thumbTop+thumbHeight*.5),vec2(4.0,thumbHeight*.5),4.0);
   col=mix(col,vec3(.12,.22,.34),fill(rail)*.85);
   col=mix(col,mist,fill(thumb)*.9);
   col+=mist*exp(-max(thumb,0.0)/6.0)*.025;
  }
  col=mix(col,muted,text(p,vec2(200,961),TEXT_SELECT));
 }else{
  ivec4 label=status==2u?TEXT_PREPARING:status==3u?TEXT_READY:status==4u?TEXT_ERROR:status==5u?TEXT_CLOSING:TEXT_DISCOVER;
  col=mix(col,ink,text(p,vec2(195,315),label));
 }
 if(status!=1u)col=mix(col,status==4u?vec3(.99,.64,.57):mist,messagePixel(p,vec2(195,380)));
 if(status==3u)col=mix(col,muted,text(p,vec2(195,465),TEXT_BACK));
 col=mix(col,muted,text(p,vec2(200,1003),TEXT_RETURN));
 outColor=vec4(col*(1.0-c.transition.x),1.0);
}
