'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
// Execute the shader's actual scalar focus/action functions as C++.
test('controller can focus Refresh and confirm it without launching an app',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mistbrew-navigation-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const helper=fs.readFileSync(path.join(__dirname,'../vendor/MintBrew/homebrew-launcher/shaders/launcher-navigation.glsl'),'utf8').replace(/inout uint (\w+)/g,'uint &$1');
 const cases=require('../vendor/MintBrew/homebrew-launcher/launcher-check-cases.cjs');
 const navCases=cases.filter(c=>!c.touch&&!c.pointer&&!c.rightStick&&!(c.buttons&1)&&(!c.steps||c.steps<=20));
 const fixtures=navCases.map(c=>{
  const count=c.count??3,selection=count?Math.min(c.selection,count-1):0,focus=count?(c.refreshFocus||0):1;
  const pressed=(c.buttons||0)&~(c.previous||0);
  const direction=pressed&(1<<13)?-1:pressed&(1<<15)?1:Math.abs(c.stick||0)>18021&&!c.cooldown?((c.stick||0)>0?-1:1):0;
  return `{uint selected=${selection}u,focus=${focus}u;const uint previous=selected,previousFocus=focus;
   if(${c.connected!==false&&!c.modal?'true':'false'})mistNavigate(${count}u,${direction},${!!(pressed&(1<<14))},${!!(pressed&(1<<12))},${!!(pressed&2)},selected,focus);
   assert(selected==${c.want}u);
   ${c.wantFocus===undefined?'':`assert(focus==${c.wantFocus}u);`}
   ${c.wantTicks===undefined?'':`assert(uint(selected!=previous||focus!=previousFocus)==${c.wantTicks}u);`}
  }`;
 }).join('\n');
 const source=`#include <algorithm>
#include <cassert>
using uint=unsigned;using std::min;
${helper}
int main(){
 ${fixtures}
 for(uint count: {0u,1u,4u,32u}){
  uint selection=0,refresh=0;
  mistNavigate(count,-1,false,false,false,selection,refresh);
  assert(refresh==1);assert(selection==0);
  assert(mistMenuAction(false,false,false,-1,count,selection,refresh)==2);
  if(!count)continue;
  mistNavigate(count,1,false,false,false,selection,refresh);
  assert(refresh==0&&selection==0);
  for(uint i=1;i<count;i++){
   mistNavigate(count,1,false,false,false,selection,refresh);
   assert(selection==i&&refresh==0);
   assert(mistMenuAction(false,false,false,-1,count,selection,refresh)==1);
  }
  mistNavigate(count,1,false,false,false,selection,refresh);
  assert(refresh==1&&selection==count-1);
  mistNavigate(count,-1,false,false,false,selection,refresh);
  assert(refresh==0&&selection==count-1);
  mistNavigate(count,0,true,false,false,selection,refresh);
  assert(refresh==1&&selection==count-1);
  mistNavigate(count,0,false,true,false,selection,refresh);
  assert(refresh==0&&selection==count-1);
  mistNavigate(count,0,true,false,false,selection,refresh);
  mistNavigate(count,0,false,false,true,selection,refresh);
  assert(refresh==0&&selection==count-1);
  for(int i=0;i<200;i++){
   mistNavigate(count,i%2?1:-1,false,false,false,selection,refresh);
   assert(selection<count&&refresh<=1);
  }
 }
 // A with a pointer uses the hovered control; keyboard focus cannot launch
 // a stale selected row when the pointer is above Refresh or outside the list.
 assert(mistMenuAction(true,true,false,-1,4,0,0)==2);
 assert(mistMenuAction(true,false,true,-1,4,0,1)==3);
 assert(mistMenuAction(true,false,false,2,4,0,1)==1);
 assert(mistMenuAction(true,false,false,-1,4,0,0)==0);
 assert(mistMenuAction(false,false,false,-1,0,0,0)==2);
}
`;
 fs.writeFileSync(path.join(directory,'navigation.cpp'),source);
 execFileSync('/usr/bin/clang++',['-std=c++17',path.join(directory,'navigation.cpp'),'-o',path.join(directory,'navigation')],{stdio:'pipe'});
 assert.doesNotThrow(()=>execFileSync(path.join(directory,'navigation'),[],{stdio:'pipe'}));
});
