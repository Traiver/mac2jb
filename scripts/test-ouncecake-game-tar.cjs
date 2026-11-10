'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {buildIndex} = require('../vendor/OunceCake/engine/mounts.cjs');
const tar = require('../integrations/mintbrew-ouncecake/game-tar.cjs');

test('game TAR streams the selected export over HTTP/WebDAV and supports resumed byte ranges', async t => {
 const title = 'Game [0400486024dec000]', name = title + '.tar';
 const japanese = '日本語-' + 'a'.repeat(105) + '.bin';
 const payload = Buffer.from(Array.from({length:1550}, (_, i) => i % 251));
 const index = buildIndex([{path:'/base',kind:'storage',mount:0,entries:[
  {path:'/empty',type:'directory'},
  {path:'/empty.bin',type:'file',size:0},
  {path:'/' + japanese,type:'file',size:payload.length}
 ]}],title);
 const reads = [];
 let failSource = false;
 const source = http.createServer((req,res) => {
  assert.equal(decodeURIComponent(req.url),'/' + title + '/base/' + japanese);
  const [,a,b] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
  const from = Number(a), to = Number(b) + 1;
  reads.push([from,to]);
  if (failSource) {res.writeHead(404).end();return;}
  res.writeHead(206,{'Content-Range':`bytes ${a}-${b}/${payload.length}`,'Content-Length':to-from})
   .end(payload.subarray(from,to));
 });
 await new Promise(resolve=>source.listen(0,'127.0.0.1',resolve));
 t.after(()=>{source.closeAllConnections();source.close();});
 const share = await tar.start({index,name,address:'127.0.0.1',switchAddress:'127.0.0.1',
  port:0,switchPort:source.address().port});
 t.after(()=>share.close());
 const file = new URL(encodeURIComponent(name),share.url);
 const directory = await fetch(share.url,{method:'PROPFIND',headers:{Depth:'1'}});
 assert.equal(directory.status,207);
 assert.ok((await directory.text()).includes(encodeURIComponent(name)));
 assert.equal((await fetch(share.url,{method:'PUT'})).status,405);
 assert.equal((await fetch(new URL('other.tar',share.url))).status,404);
 const head = await fetch(file,{method:'HEAD'});
 assert.equal(head.headers.get('accept-ranges'),'bytes');assert.deepEqual(reads,[]);
 const full = Buffer.from(await (await fetch(file)).arrayBuffer());
 assert.equal(full.length,Number(head.headers.get('content-length')));
 assert.deepEqual(reads,[[0,payload.length]]);
 const local = await fs.mkdtemp(path.join(os.tmpdir(),'mac2jb-game-tar-'));
 t.after(()=>fs.rm(local,{recursive:true,force:true}));
 const archive = path.join(local,'game.tar');
 await fs.writeFile(archive,full);
 execFileSync('/usr/bin/tar',['-xf',archive,'-C',local]);
 const base = path.join(local,title,'base');
 assert.deepEqual(await fs.readFile(path.join(base,japanese)),payload);
 assert.ok((await fs.stat(path.join(base,'empty'))).isDirectory());
 assert.equal((await fs.stat(path.join(base,'empty.bin'))).size,0);
 const start = full.indexOf(payload) + 5;
 const partial = await fetch(file,{headers:{Range:`bytes=${start}-${start+23}`}});
 assert.equal(partial.status,206);
 assert.deepEqual(Buffer.from(await partial.arrayBuffer()),full.subarray(start,start+24));
 assert.deepEqual(reads.at(-1),[5,29]);
 const suffix = await fetch(file,{headers:{Range:'bytes=-1024'}});
 assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),Buffer.alloc(1024));
 assert.equal((await fetch(file,{headers:{Range:`bytes=${full.length}-`}})).status,416);
 failSource = true;
 await assert.rejects(async()=>{const response=await fetch(file);await response.arrayBuffer();});
 await share.close();
});
