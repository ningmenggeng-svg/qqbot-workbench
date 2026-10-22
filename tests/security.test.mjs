import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {requireBotIdentity} from '../src/napcat.mjs';

const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
const headers={'X-QQBot-Action':'local-control','Content-Type':'application/json'};

test('独立机器人身份和隔离确认是启动前置条件',()=>{
  assert.throws(()=>requireBotIdentity({botQQ:'',botConfirmed:false},true),/机器人/);
  assert.throws(()=>requireBotIdentity({botQQ:'123456789',botConfirmed:true},false),/独立 Windows/);
  assert.doesNotThrow(()=>requireBotIdentity({botQQ:'123456789',botConfirmed:true,groupIds:[]},true));
});

test('新安装为空白配置，跨站请求被阻止，失败提交不改配置',async t=>{
  const data=fs.mkdtempSync(path.join(os.tmpdir(),'qqbot-test-'));
  const port=await freePort();
  const child=spawn(process.execPath,[path.join(app,'src','server.mjs')],{cwd:app,windowsHide:true,env:{...process.env,QQBOT_DATA_DIR:data,QQBOT_PORT:String(port),QQBOT_SKIP_BOOTSTRAP:'1'},stdio:['ignore','pipe','pipe']});
  let error='';child.stderr.on('data',d=>error+=d.toString());
  t.after(async()=>{try{await fetch(`http://127.0.0.1:${port}/api/shutdown`,{method:'POST',headers,body:'{}'});}catch{}if(child.exitCode===null)child.kill();fs.rmSync(data,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  let ready=false;
  for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/status',{headers});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,60));}
  assert.ok(ready,error);
  const initial=await(await fetch(base+'/api/status',{headers})).json();
  assert.equal(initial.auth.connected,false);assert.equal(initial.settings.botQQ,'');assert.deepEqual(initial.settings.groupIds,[]);assert.equal(initial.settings.enabled,false);
  assert.equal(initial.services.qqConnected,false);assert.equal(initial.services.napcat,false);
  for(const secret of ['cpaKey','managementKey','botToken','dashboardPassword','qqWebToken'])assert.ok(!JSON.stringify(initial).includes(secret));
  assert.equal((await fetch(base+'/api/status')).status,403);
  assert.equal((await fetch(base+'/api/settings',{method:'POST',headers:{...headers,Origin:'https://untrusted.example'},body:JSON.stringify({groupIds:'123456'})})).status,403);
  const before=fs.readFileSync(path.join(data,'state','settings.json'),'utf8');
  const invalid=await fetch(base+'/api/settings',{method:'POST',headers,body:JSON.stringify({model:'would-mutate',groupIds:'invalid'})});
  assert.equal(invalid.status,400);assert.equal(fs.readFileSync(path.join(data,'state','settings.json'),'utf8'),before);
  const after=await(await fetch(base+'/api/status',{headers})).json();assert.equal(after.settings.model,'');
  const noBot=await fetch(base+'/api/napcat/start',{method:'POST',headers,body:JSON.stringify({isolated:true})});assert.equal(noBot.status,400);assert.ok(!fs.existsSync(path.join(data,'apps','napcat')));
  const malformed=await fetch(base+'/api/settings',{method:'POST',headers,body:'{"password":"do-not-echo-this-secret"'});assert.equal(malformed.status,400);assert.ok(!(await malformed.text()).includes('do-not-echo'));
  const html=await(await fetch(base+'/')).text();assert.ok(html.includes('QQ 小号密码'));assert.ok(html.indexOf('id="qq"')<html.indexOf('id="account"'));
});
