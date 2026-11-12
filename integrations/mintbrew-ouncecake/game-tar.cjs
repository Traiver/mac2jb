'use strict';
// Stream a TAR on the Mac from the same read-only HTTP index the Switch serves.
const http = require('node:http');
const {isIPv4} = require('node:net');
const {Readable} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const BLOCK = 512n;
const MAX_TAR_SIZE_FIELD = 0o77777777777n;
const padded = size => (size + BLOCK - 1n) & ~(BLOCK - 1n);
const zeros = Buffer.alloc(1024);
const encodePath = path => path.split('/').map(encodeURIComponent).join('/');
const escape = text => text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const check = (condition, message) => { if (!condition) throw Error(message); };

function header(name, size, type) {
 const bytes = Buffer.alloc(Number(BLOCK));
 const octal = (value, at, width) => bytes.write(value.toString(8).padStart(width - 1, '0'), at);
 bytes.write(name, 0, 100, 'ascii');
 octal(type === '5' ? 0o755 : 0o644, 100, 8);
 octal(0, 108, 8); octal(0, 116, 8); octal(size, 124, 12); octal(0, 136, 12);
 bytes.fill(32, 148, 156);
 bytes[156] = type.charCodeAt(0);
 bytes.write('ustar\0' + '00', 257, 'ascii');
 const sum = bytes.reduce((total, byte) => total + byte, 0);
 bytes.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
 return bytes;
}

function paxRecord(key, value) {
 const body = ' ' + key + '=' + value + '\n';
 const bytes = Buffer.byteLength(body);
 let length = bytes + 1;
 while (length !== bytes + String(length).length) length = bytes + String(length).length;
 return String(length) + body;
}

function plan(index) {
 check(Buffer.isBuffer(index) && index.length >= 64 && index.toString('ascii', 0, 8) === 'NS2FTPIX' &&
  index.readUInt32LE(8) === 1 && index.readUInt32LE(12) === 48, 'Invalid game export index for TAR');
 const count = Number(index.readBigUInt64LE(16)), strings = 64 + 48 * count;
 check(Number.isSafeInteger(count) && count > 1 && strings < index.length &&
  index.readBigUInt64LE(24) === 64n && index.readBigUInt64LE(32) === BigInt(strings) &&
  index.readBigUInt64LE(40) === BigInt(index.length - strings) &&
  index.readBigUInt64LE(48) === BigInt(index.length), 'Invalid game export index layout');
 const utf8 = new TextDecoder('utf-8', {fatal:true,ignoreBOM:true});
 const members = [{path:'', directory:true}];
 let position = 0n;
 for (let id = 1; id < count; id++) {
  const at = 64 + 48 * id, parent = index.readUInt32LE(at), kind = index.readUInt32LE(at + 12);
  const start = strings + index.readUInt32LE(at + 16), length = index.readUInt32LE(at + 20);
  check(parent < id && members[parent].directory && kind <= 1 && length > 0 && start + length < index.length &&
   index[start + length] === 0, 'Invalid game export entry for TAR');
  const name = utf8.decode(index.subarray(start, start + length));
  check(name !== '.' && name !== '..' && !/[\\/\x00-\x1f\x7f]/.test(name), 'Invalid game export name for TAR');
  const path = members[parent].path ? members[parent].path + '/' + name : name;
  const directory = kind === 0, filename = path + (directory ? '/' : '');
  const size = directory ? 0n : index.readBigUInt64LE(at + 40);
  const shortName = /^[\x20-\x7e]{1,100}$/.test(filename);
  const large = size > MAX_TAR_SIZE_FIELD;
  const pax = Buffer.from((shortName ? '' : paxRecord('path', filename)) + (large ? paxRecord('size', String(size)) : ''));
  const data = position + BLOCK + (pax.length ? BLOCK + padded(BigInt(pax.length)) : 0n);
  const end = data + padded(size);
  members.push({id, path, directory, name:shortName ? filename : 'Entry-' + id, pax, size, large, data, start:position, end});
  position = end;
 }
 return {members:members.slice(1), size:position + 2n * BLOCK};
}

function requestRange(value, size) {
 if (value === undefined) return {start:0n, end:size};
 const match = /^bytes=(\d{0,24})-(\d{0,24})$/.exec(value);
 if (!match || !(match[1] || match[2])) return null;
 const min = (a, b) => a < b ? a : b;
 if (!match[1]) {
  const suffix = BigInt(match[2]);
  return suffix ? {start:size-min(size,suffix), end:size} : null;
 }
 const start = BigInt(match[1]), end = match[2] ? min(size,BigInt(match[2])+1n) : size;
 return start < end ? {start,end} : null;
}

async function* sourceBytes(member, first, end, origin, agent, signal) {
 const remote = await new Promise((resolve, reject) => {
  const request = http.get(origin + '/' + encodePath(member.path), {
   agent, signal, headers:{Range:'bytes=' + first + '-' + (end - 1n)}
  }, resolve);
  request.on('error', reject);
  request.setTimeout(30000, () => request.destroy(Error('Switch HTTP download timed out')));
 });
 try {
  const range = 'bytes ' + first + '-' + (end - 1n) + '/' + member.size;
  check((remote.statusCode === 206 && remote.headers['content-range'] === range ||
   remote.statusCode === 200 && first === 0n && end === member.size) &&
   remote.headers['content-length'] === String(end - first), 'Unexpected Switch HTTP response for ' + member.path);
  let left = end - first;
  for await (const chunk of remote) {
   left -= BigInt(chunk.length);
   check(left >= 0n, 'Switch sent too many bytes for ' + member.path);
   yield chunk;
  }
  check(left === 0n && remote.complete, 'Switch download ended early for ' + member.path);
 } finally {
  remote.destroy();
 }
}

async function* archiveBytes(archive, range, origin, agent, signal) {
 function* slice(buffer, position) {
  const start = range.start > position ? range.start - position : 0n;
  const end = range.end - position;
  if (start < BigInt(buffer.length) && end > start)
   yield buffer.subarray(Number(start), Number(end < BigInt(buffer.length) ? end : BigInt(buffer.length)));
 }
 let first = 0, last = archive.members.length;
 while (first < last) {
  const middle = (first + last) >>> 1;
  if (archive.members[middle].end <= range.start) first = middle + 1;
  else last = middle;
 }
 for (let i = first; i < archive.members.length; i++) {
  const member = archive.members[i];
  if (member.start >= range.end) break;
  signal.throwIfAborted();
  if (member.pax.length) {
   const paxSize = BigInt(member.pax.length);
   yield* slice(header('PaxHeaders/' + member.id, paxSize, 'x'), member.start);
   yield* slice(member.pax, member.start + BLOCK);
   yield* slice(zeros.subarray(0, Number(padded(paxSize) - paxSize)), member.start + BLOCK + paxSize);
  }
  yield* slice(header(member.name, member.large ? 0n : member.size, member.directory ? '5' : '0'), member.data - BLOCK);
  const from = range.start > member.data ? range.start - member.data : 0n;
  const to = range.end < member.data + member.size ? range.end - member.data : member.size;
  if (from < to) yield* sourceBytes(member, from, to, origin, agent, signal);
  yield* slice(zeros.subarray(0, Number(padded(member.size) - member.size)), member.data + member.size);
 }
 yield* slice(zeros, archive.size - 2n * BLOCK);
}

async function start({index, name, switchAddress, address, port = 8081, switchPort = 8080}) {
 check(isIPv4(address) && isIPv4(switchAddress) && typeof name === 'string' &&
  name.endsWith('.tar') && !/[\\/\x00-\x1f\x7f]/.test(name), 'Invalid TAR export endpoint');
 const archive = plan(index), origin = 'http://' + switchAddress + ':' + switchPort;
 const filename = '/' + encodeURIComponent(name), allow = 'GET, HEAD, OPTIONS, PROPFIND';
 const agent = new http.Agent({keepAlive:true,maxSockets:1});
 let active, closing;
 const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control','no-store');
  let route;
  try {route = decodeURIComponent(req.url.split('?')[0]);}
  catch {res.writeHead(400).end();return;}
  if (route !== '/' && route !== '/' + name) {res.writeHead(404).end();return;}
  if (req.method === 'OPTIONS') {res.writeHead(200,{Allow:allow,DAV:'1'}).end();return;}
  if (req.method === 'PROPFIND') {
   const entry = (href, display, dir) => '<D:response><D:href>' + href + '</D:href><D:propstat><D:prop><D:displayname>' +
    escape(display) + '</D:displayname><D:resourcetype>' + (dir ? '<D:collection/>' : '') +
    '</D:resourcetype>' + (dir ? '' : '<D:getcontentlength>' + archive.size + '</D:getcontentlength>') +
    '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
   const file = entry(filename,name,false);
   const list = route === '/' ? entry('/','TAR export',true) + (req.headers.depth === '0' ? '' : file) : file;
   res.writeHead(207,{'Content-Type':'application/xml; charset=utf-8'}).end('<D:multistatus xmlns:D="DAV:">' + list + '</D:multistatus>');
   return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {res.writeHead(405,{Allow:allow}).end();return;}
  if (route === '/') {
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'})
    .end('<!doctype html><meta charset="utf-8"><a href="' + filename + '">' + escape(name) + '</a>');
   return;
  }
  const range = requestRange(req.headers.range,archive.size);
  if (!range) {res.writeHead(416,{'Content-Range':'bytes */' + archive.size}).end();return;}
  if (req.method === 'GET' && active) {res.writeHead(503,{'Retry-After':'2'}).end();return;}
  const headers = {'Content-Length':String(range.end - range.start),'Content-Type':'application/x-tar','Accept-Ranges':'bytes',
   'Content-Disposition':"attachment; filename*=UTF-8''" + encodeURIComponent(name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))};
  if (req.headers.range) headers['Content-Range'] = 'bytes ' + range.start + '-' + (range.end - 1n) + '/' + archive.size;
  res.writeHead(req.headers.range ? 206 : 200,headers);
  if (req.method === 'HEAD') {res.end();return;}
  const controller = new AbortController();
  active = controller;
  res.once('close', () => controller.abort());
  try {await pipeline(Readable.from(archiveBytes(archive,range,origin,agent,controller.signal)),res,{signal:controller.signal});}
  catch (error) {res.destroy(error);}
  finally {active = null;}
 });
 try {
  await new Promise((resolve,reject)=>{
   server.once('error',reject);
   server.listen(port,address,()=>{server.off('error',reject);resolve();});
  });
 } catch(error) {agent.destroy();throw error;}
 return {url:'http://' + address + ':' + server.address().port + '/',close(){
  if (!closing) {
   active?.abort();
   agent.destroy();
   closing = new Promise(resolve=>server.close(resolve));
   server.closeAllConnections();
  }
  return closing;
 }};
}

module.exports = {start};
