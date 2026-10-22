import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createNapcatBridge} from '../src/napcat.mjs';

test('密码只以协议要求的摘要发给本机组件，错误账号不会启用群消息',async t=>{
  const seen=[];let stopped=false,astrStarted=false;
  const upstream=http.createServer(async(req,res)=>{let text='';for await(const d of req)text+=d;const data=text?JSON.parse(text):{};seen.push({url:req.url,data});let result={};if(req.url==='/api/auth/login')result={Credential:'test-session-token'};if(req.url==='/api/QQLogin/CheckLoginStatus')result={isLogin:true};if(req.url==='/api/QQLogin/GetQQLoginInfo')result={uin:'999999999'};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({code:0,data:result}));});
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'qqbot-napcat-contract-'));
  t.after(()=>{upstream.close();fs.rmSync(root,{recursive:true,force:true});});
  const settings={botQQ:'123456789',botConfirmed:true,groupIds:['123456'],enabled:true,model:'test-model',botToken:'test-onebot',qqWebToken:'test-web-token'};
  const saveJSON=(p,d)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(d));};
  const bridge=createNapcatBridge({root,ports:{napcat:upstream.address().port,onebot:6199},getSettings:()=>settings,runTool:async()=>'',unpack:async()=>{},launch:()=>{throw new Error('测试不得启动 QQ');},stop:async()=>{stopped=true;},probe:async()=>true,owned:()=>true,startAstrbot:async()=>{astrStarted=true;},saveJSON,readJSON:(_,fallback)=>fallback});
  const password='example-password-for-contract-test';await bridge.passwordLogin(password);
  const login=seen.find(r=>r.url.endsWith('/PasswordLogin'));
  assert.equal(login.data.uin,settings.botQQ);assert.equal(login.data.passwordMd5,crypto.createHash('md5').update(password).digest('hex'));assert.ok(!JSON.stringify(seen).includes(password));
  assert.deepEqual(fs.readdirSync(root),[]);
  await assert.rejects(()=>bridge.check(),/账号.*不一致/);assert.equal(stopped,true);assert.equal(astrStarted,false);assert.ok(!seen.some(r=>r.url.includes('OB11Config')));
});
