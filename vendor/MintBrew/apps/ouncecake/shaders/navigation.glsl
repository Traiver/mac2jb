#ifndef OUNCECAKE_NAVIGATION_GLSL
#define OUNCECAKE_NAVIGATION_GLSL
// Shared with the host-side input tests; no change to the GPU state-buffer ABI.
#ifndef OUNCE_INOUT_FLOAT
#define OUNCE_INOUT_FLOAT inout float
#define OUNCE_INOUT_INT inout int
#endif
#ifndef OUNCE_INOUT_UINT
#define OUNCE_INOUT_UINT inout uint
#endif
void ounceResetSelection(uint count,uint focus,OUNCE_INOUT_UINT selection,OUNCE_INOUT_UINT scroll,OUNCE_INOUT_FLOAT delay,OUNCE_INOUT_INT held){
 selection=count>0u?min(focus,count-1u):0u;
 scroll=selection>=8u?selection-7u:0u;
 delay=0.0;held=0;
}
int ounceNavigation(uint pressed,uint buttons,float stick,OUNCE_INOUT_FLOAT delay,OUNCE_INOUT_INT previous){
 const float tick=1.0/60.0;
 delay=max(0.0,delay-tick);
 bool up=(buttons&HB_UP)!=0u,down=(buttons&HB_DOWN)!=0u;
 int held=0,step=0;
 if(up!=down)held=up?-1:1;
 else if(!up&&!down&&abs(stick)>.55)held=stick>0.0?-1:1;
 if(held==0){previous=0;delay=0.0;}
 else if(held!=previous){step=held;previous=held;delay=.30;}
 else if(delay<=0.0){step=held;delay=.075;}
 // Shoulder buttons retain their existing one-page-per-press behavior.
 if((pressed&HB_L)!=0u){step=-8;delay=.30;}
 if((pressed&HB_R)!=0u){step=8;delay=.30;}
 return step;
}
float ounceThumbHeight(uint count,float height){
 if(count<=8u)return height;
 return min(height,max(36.0,height*8.0/float(count)));
}
float ounceThumbOffset(uint count,uint scroll,float height){
 uint maximum=count>8u?count-8u:0u;
 if(maximum==0u)return 0.0;
 return float(min(scroll,maximum))/float(maximum)*(height-ounceThumbHeight(count,height));
}
#endif
