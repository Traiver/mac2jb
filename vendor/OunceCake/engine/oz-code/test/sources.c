// mac2jb: exercise the host/native source ABI and complete open/read/close transactions.
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "../native.c"
static u32 expected_kind, expected_proxy, opened, closed, reads, fail_command;
static u64 expected_id = 0x0100000000001234ULL;
static int test_poll(PollFd *p,u64 n,int timeout) {(void)p;(void)n;(void)timeout;return 0;}
static u32 test_close(u32 handle) {assert(handle==20||handle==30);closed++;return 0;}
static u32 test_ipc(void *buffer,u64 bytes,u32 handle) {
    (void)bytes;u32 *p=buffer;u32 at=(p[0]>>24)?32:16;
    u32 command=*(u32*)((u8*)p+at+8);u64 input[3]={0};memcpy(input,(u8*)p+at+16,24);
    if(command==fail_command)return 0xbad;
    u32 moved=0;u64 result=0;
    if(command==10) {
        assert(expected_kind==3&&handle==10);assert((input[0]>>32)==expected_proxy);assert(input[1]==expected_id);moved=20;opened++;
    } else if(command==8||command==206) {
        assert(handle==(expected_kind==3?20:10));
        if(command==206)assert((input[0]>>32)==expected_proxy);
        moved=30;opened++;
    } else if(command==4) {
        assert(expected_kind==2&&handle==30);result=1000;
    } else {
        assert(command==0&&handle==(expected_kind?30:10));reads++;
        assert(input[(expected_kind==1||expected_kind==3)?1:0]==7);result=13;
    }
    memset(p,0,128);p[4]=0x4f434653;
    if(moved){p[1]=0x80000000;p[2]=1u<<5;p[3]=moved;}
    *(u64*)(p+8)=result;return 0;
}
int main(void) {
    u8 ipc[8192]={0},data[64]={0};const char strings[]="/file.bin\0@UserContent://registered/test.nca\0";
    ServerFunctions f={.ipc=test_ipc,.close_handle=test_close,.poll=test_poll};
    ServerConfig config={.functions=&f,.ipc_buffer=ipc,.data=data,.data_bytes=64};
    Source source={.handle=10,.size=1000};Node node={.mount=0,.source_path=0,.offset=10,.size=13};
    Server server={.c=&config,.strings=strings};config.sources=&source;
    for(u32 kind=0;kind<=3;kind++) {
        expected_kind=source.kind=kind;expected_proxy=source.proxy_type=kind==2?1:4;
        source.size=kind==3?expected_id:1000;node.source_path=kind==2?10:0;
        opened=closed=reads=0;fail_command=0xffffffffu;
        assert(read_source(&server,&node,7,13));assert(reads==1);assert(!config.io_lock);
        assert(opened==(kind==3?2:kind?1:0));assert(closed==opened);
    }
    expected_kind=source.kind=3;expected_proxy=source.proxy_type=4;source.program_id=expected_id;
    opened=closed=0;fail_command=8;assert(!read_source(&server,&node,7,13));assert(opened==1&&closed==1&&!config.io_lock);
    config.stop=1;assert(!read_source(&server,&node,7,13));assert(!config.io_lock);
    puts("All four native source kinds and failed-open cleanup passed.");return 0;
}
