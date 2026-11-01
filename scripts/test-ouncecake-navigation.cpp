#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <initializer_list>
using uint=unsigned;
static float max(float a,float b){return a>b?a:b;}
static float min(float a,float b){return a<b?a:b;}
static uint min(uint a,uint b){return a<b?a:b;}
static constexpr uint HB_UP=8192u,HB_DOWN=32768u,HB_L=64u,HB_R=128u;
#define OUNCE_INOUT_FLOAT float&
#define OUNCE_INOUT_INT int&
#define OUNCE_INOUT_UINT uint&
#include "../integrations/mintbrew-ouncecake/app/shaders/navigation.glsl"
static void check(bool ok,const char* message){if(!ok){std::fprintf(stderr,"FAIL: %s\n",message);std::exit(1);}}
int main(){
 float delay=0;int held=0;
 check(ounceNavigation(HB_DOWN,HB_DOWN,0,delay,held)==1,"tap moves immediately");
 for(int n=0;n<12;n++)check(ounceNavigation(0,HB_DOWN,0,delay,held)==0,"initial repeat delay prevents double taps");
 int repeated=0;for(int n=0;n<60;n++)repeated+=ounceNavigation(0,HB_DOWN,0,delay,held);
 check(repeated>=9&&repeated<=13,"held D-pad continues scrolling at a controlled repeat rate");
 check(ounceNavigation(0,0,0,delay,held)==0&&held==0&&delay==0,"release immediately clears repeat state");
 check(ounceNavigation(HB_UP,HB_UP,0,delay,held)==-1,"opposite press moves immediately");
 check(ounceNavigation(0,HB_DOWN,0,delay,held)==1,"direction change resets initial delay");
 check(ounceNavigation(0,HB_UP|HB_DOWN,0,delay,held)==0&&held==0,"opposing D-pad inputs cancel");
 check(ounceNavigation(0,0,.3f,delay,held)==0,"stick deadzone prevents drift");
 check(ounceNavigation(0,0,.8f,delay,held)==-1,"stick navigation still works");
 int stickSteps=0;for(int n=0;n<60;n++)stickSteps+=ounceNavigation(0,0,.8f,delay,held);
 check(stickSteps<-5,"holding the stick continues navigation");
 check(ounceNavigation(HB_R,HB_R,0,delay,held)==8,"right shoulder pages down");
 check(ounceNavigation(0,HB_R,0,delay,held)==0,"held shoulder does not repeat pages");
 check(ounceNavigation(HB_L,HB_L,0,delay,held)==-8,"left shoulder pages up");
 for(uint count: {0u,1u,8u,9u,167u,1000u,1001u}){
  const float height=590,thumb=ounceThumbHeight(count,height);
  check(thumb>=36&&thumb<=height,"scroll thumb stays readable and inside track");
  check(ounceThumbOffset(count,0,height)==0,"top of list aligns with top of rail");
  if(count<=8)check(thumb==height&&ounceThumbOffset(count,999,height)==0,"fully visible list has no scrolling");
  else{
   const uint maximum=count-8;float previous=-1;
   for(uint scroll=0;scroll<=maximum;scroll++){
    const float offset=ounceThumbOffset(count,scroll,height);
    check(offset>=previous&&offset>=0&&offset+thumb<=height+.001f,"thumb tracks scroll monotonically within bounds");previous=offset;
   }
   check(std::fabs(ounceThumbOffset(count,maximum,height)+thumb-height)<.001f,"end of list aligns with end of rail");
   check(ounceThumbOffset(count,99999,height)==ounceThumbOffset(count,maximum,height),"scroll position is clamped");
  }
 }
 uint selection=999,scroll=992;held=1;delay=.075;
 ounceResetSelection(4,1,selection,scroll,delay,held);
 check(selection==1&&scroll==0&&held==0&&delay==0,"opening a folder resets stale selection and input repeat");
 ounceResetSelection(30,25,selection,scroll,delay,held);
 check(selection==25&&scroll==18,"returning restores the System Files folder in view");
 ounceResetSelection(0,999,selection,scroll,delay,held);
 check(selection==0&&scroll==0,"empty transitional catalog cannot underflow");
 std::puts("PASS: actual shared GLSL navigation and scrollbar math; tap, hold, release, reversal, stick, paging, and list boundaries.");
}
