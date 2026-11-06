// Controller focus retains a valid app index while visiting the Refresh button.
void mistNavigate(uint count,int direction,bool right,bool left,bool back,
                  inout uint selection,inout uint refreshFocus){
 count=min(count,32u);
 if(count==0u){selection=0u;refreshFocus=1u;return;}
 selection=min(selection,count-1u);
 if(back||left){refreshFocus=0u;return;}
 if(right){refreshFocus=1u;return;}
 if(direction==0)return;
 if(refreshFocus!=0u){refreshFocus=0u;selection=direction>0?0u:count-1u;}
 else if(direction<0){if(selection==0u)refreshFocus=1u;else selection--;}
 else {if(selection+1u>=count)refreshFocus=1u;else selection++;}
}
// 0: no action, 1: launch app, 2: refresh, 3: appearance switch.
uint mistMenuAction(bool pointer,bool overRefresh,bool overSwitch,int hoverIndex,
                    uint count,uint selection,uint refreshFocus){
 if(pointer){
  if(overRefresh)return 2u;
  if(overSwitch)return 3u;
  return hoverIndex>=0&&uint(hoverIndex)<count?1u:0u;
 }
 if(refreshFocus!=0u||count==0u)return 2u;
 return selection<count?1u:0u;
}
