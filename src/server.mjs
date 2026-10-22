import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNapcatBridge } from './napcat.mjs';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(process.env.QQBOT_DATA_DIR || path.join(APP, 'local-data'));
const RUNTIME = path.resolve(process.env.QQBOT_RUNTIME_DIR || path.join(APP, 'runtime'));
const PORT = Number(process.env.QQBOT_PORT || 8766);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STATE = path.join(ROOT, 'state');
const LOGS = path.join(ROOT, 'logs');
const CPA = path.join(ROOT, 'apps', 'cpa');
const ASTR = path.join(ROOT, 'apps', 'astrbot');
const PYTHON = path.join(ROOT, '.venv', 'Scripts', 'python.exe');
const ASTR_CONFIG = path.join(ASTR, 'data', 'cmd_config.json');
for (const p of [STATE, LOGS, ASTR]) fs.mkdirSync(p, { recursive: true });

const readJSON = (p, fallback = null) => { try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); } catch { return fallback; } };
const saveJSON = (p, data) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(p + '.tmp', p); };
const settingsFile = path.join(STATE, 'settings.json');
let settings = readJSON(settingsFile) || {
  cpaKey: crypto.randomBytes(24).toString('hex'), managementKey: crypto.randomBytes(24).toString('hex'),
  botToken: crypto.randomBytes(24).toString('hex'), dashboardPassword: crypto.randomBytes(18).toString('base64url'),
  model: '', proxyUrl: '', groupIds: [], botQQ: '', botConfirmed: false, enabled:false,testPassed: false,qqWebToken:crypto.randomBytes(24).toString('hex'),
  ports: {cpa:8317,astrbot:6185,onebot:6199,napcat:6099},
};
settings.ports ||= {cpa:8317,astrbot:6185,onebot:6199,napcat:6099};
if(!fs.existsSync(settingsFile)) {
  for(const key of Object.keys(settings.ports)) settings.ports[key]=await availablePort(settings.ports[key]);
}
saveJSON(settingsFile, settings);
const ports=settings.ports;
const children = new Map();
const toolProcesses = new Set();
let auth = { state: '', url: '', started: 0, error: '' };
let lastTest = null;
let astrBusy = false;
let setupBusy = false;
let shuttingDown = false;
const processFile=path.join(STATE,'processes.json');
let processRegistry=readJSON(processFile,{});
const napcatBridge=createNapcatBridge({root:ROOT,ports,getSettings:()=>settings,runTool,unpack,launch,stop,probe,owned:()=>!!processRegistry.napcat,startAstrbot,saveJSON,readJSON});

function availablePort(preferred) {
  return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',()=>{const t=net.createServer();t.once('error',reject);t.listen(0,'127.0.0.1',()=>{const p=t.address().port;t.close(()=>resolve(p));});});s.listen(preferred,'127.0.0.1',()=>s.close(()=>resolve(preferred)));});
}
function setupState(phase,message,ready=false){saveJSON(path.join(ROOT,'setup-status.json'),{phase,message,ready,updated:new Date().toISOString()});}
function runTool(exe,args,{cwd=ROOT,env={},name='install'}={}) {
  if(shuttingDown && name!=='stop')return Promise.reject(new Error('工作台正在退出。'));
  const toolEnv={...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',UV_CACHE_DIR:path.join(ROOT,'.cache','uv'),UV_PYTHON_INSTALL_DIR:path.join(ROOT,'runtime','python'),UV_PYTHON_PREFERENCE:'only-managed',...env};
  if(exe.toLowerCase()==='powershell.exe'){delete toolEnv.PSModulePath;const i=args.indexOf('-Command');if(i>=0)args=[...args.slice(0,i+1),'[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '+args[i+1]];}
  return new Promise((resolve,reject)=>{const p=spawn(exe,args,{cwd,windowsHide:true,env:toolEnv,stdio:['ignore','pipe','pipe']});toolProcesses.add(p);let output='';p.stdout.on('data',d=>{output+=d;log(name,d.toString());});p.stderr.on('data',d=>{output+=d;log(name,d.toString());});p.once('error',e=>{toolProcesses.delete(p);reject(e);});p.once('exit',code=>{toolProcesses.delete(p);code===0?resolve(output):reject(new Error('准备步骤未完成，请查看运行记录后重试。'));});});
}
async function unpack(archive,destination) {
  fs.mkdirSync(destination,{recursive:true});
  const script=String.raw`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $taskRoot=[IO.Path]::GetFullPath($env:QQBOT_DESTINATION).TrimEnd('\')+'\'; $taskZip=[IO.Compression.ZipFile]::OpenRead($env:QQBOT_ARCHIVE); try { foreach($taskEntry in $taskZip.Entries) { $taskTarget=[IO.Path]::GetFullPath([IO.Path]::Combine($taskRoot,$taskEntry.FullName)); if(-not $taskTarget.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase)){throw 'Invalid archive path'}; if($taskEntry.Name -eq ''){[IO.Directory]::CreateDirectory($taskTarget) | Out-Null}else{[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($taskTarget)) | Out-Null; [IO.Compression.ZipFileExtensions]::ExtractToFile($taskEntry,$taskTarget,$true)} } } finally {$taskZip.Dispose()}`;
  await runTool('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{env:{QQBOT_ARCHIVE:archive,QQBOT_DESTINATION:destination}});
}
async function prepareEnvironment() {
  if(setupBusy)return;
  setupBusy=true;
  try {
    setupState('cpa','正在准备 CPA 模型接口');
    if(!fs.existsSync(path.join(CPA,'cli-proxy-api.exe'))){
      const archive=path.join(RUNTIME,'cpa.zip');
      const hash=crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
      if(hash!=='4b54808ee28174dca5ac10f711d33958043609ed3dc0c92bbcef63329f3a59f3')throw new Error('CPA 发布包校验失败。');
      await unpack(archive,CPA);
    }
    await startCPA();
    if(!fs.existsSync(path.join(ROOT,'.venv','Scripts','astrbot.exe'))){
      const uv=path.join(RUNTIME,'uv.exe');
      setupState('python','正在自动准备独立 Python 环境');
      await runTool(uv,['python','install','3.12','--no-bin','--no-registry']);
      await runTool(uv,['venv','--python','3.12',path.join(ROOT,'.venv')]);
      setupState('install','正在安装 AstrBot，首次准备需要下载依赖');
      await runTool(uv,['pip','install','--python',PYTHON,'--requirement',path.join(APP,'requirements-windows.lock'),'--index-url','https://pypi.org/simple']);
    }
    setupState('ready','运行环境已就绪。连接 ChatGPT，并填写独立机器人号与群号。',true);
  }catch(e){if(!shuttingDown){setupState('error',scrub(e.message));log('install',`\n${scrub(e.stack)}\n`);}}
  finally{setupBusy=false;}
}

function scrub(input) {
  let text = String(input ?? '').replace(/\u001b\[[0-9;]*m/g, '');
  for (const secret of [settings.cpaKey, settings.managementKey, settings.botToken, settings.dashboardPassword,settings.qqWebToken]) if (secret) text = text.split(secret).join('[已隐藏]');
  return text.replace(/https:\/\/auth\.openai\.com\/[^\s"<>]+/g, '[登录链接已隐藏]')
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[已隐藏]')
    .replace(/((?:access_token|refresh_token|id_token|api_key|jwt_secret|password(?:Md5)?)\s*[=:]\s*)[^\s,]+/gi, '$1[已隐藏]');
}
function log(name, text) { fs.appendFileSync(path.join(LOGS, `${name}.log`), scrub(text)); }
function tail(name, lines = 65) { try { const f=fs.readFileSync(path.join(LOGS, `${name}.log`), 'utf8'); return scrub(f.split(/\r?\n/).slice(-lines).join('\n')); } catch { return ''; } }
function probe(port) { return new Promise(resolve => { const s=net.connect({host:'127.0.0.1',port}); const done=ok=>{s.destroy();resolve(ok);}; s.setTimeout(650,()=>done(false));s.once('connect',()=>done(true));s.once('error',()=>done(false)); }); }
function credentialCount() { try { return fs.readdirSync(path.join(CPA,'auths')).filter(n=>n.endsWith('.json')).filter(n=>{const d=readJSON(path.join(CPA,'auths',n));return d?.type==='codex'&&!d.disabled;}).length; } catch { return 0; } }
function cpaConfig() {
  const j=JSON.stringify;
  return `config-version: 8\nserver:\n  host: "127.0.0.1"\n  port: ${ports.cpa}\nmanagement:\n  allow-remote: false\n  secret-key: ${j(settings.managementKey)}\n  disable-control-panel: true\naccess:\n  api-keys:\n    - ${j(settings.cpaKey)}\noauth:\n  auth-dir: ${j(path.join(CPA,'auths').replaceAll('\\','/'))}\nrequests:\n  proxy-url: ${j(settings.proxyUrl)}\n`;
}
function launch(name, exe, args, cwd, extraEnv={}) {
  if(shuttingDown)throw new Error('工作台正在退出。');
  const current=children.get(name); if(current && current.exitCode===null) return current;
  log(name, `\n[${new Date().toISOString()}] 启动服务\n`);
  const child=spawn(exe,args,{cwd,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONUNBUFFERED:'1',...extraEnv},stdio:['ignore','pipe','pipe']});
  children.set(name,child);
  child.once('spawn',()=>{processRegistry[name]={pid:child.pid,exe};saveJSON(processFile,processRegistry);});
  child.stdout.on('data',d=>log(name,d.toString('utf8')));
  child.stderr.on('data',d=>log(name,d.toString('utf8')));
  child.on('error',e=>log(name,`\n启动失败：${e.message}\n`));
  child.on('exit',(code,signal)=>{log(name,`\n服务退出：${code ?? signal}\n`);if(processRegistry[name]?.pid===child.pid){delete processRegistry[name];saveJSON(processFile,processRegistry);}});
  return child;
}
async function stop(name) {
  const c=children.get(name);
  if(!c || c.exitCode!==null){
    const record=processRegistry[name];
    if(record){await runTool('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$taskPid=[int]$env:QQBOT_TARGET_PID; $taskProcess=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$taskPid) -ErrorAction SilentlyContinue; if($taskProcess -and $taskProcess.ExecutablePath -ieq $env:QQBOT_TARGET_EXE){Stop-Process -Id $taskPid -Force}"],{name:'stop',env:{QQBOT_TARGET_PID:String(record.pid),QQBOT_TARGET_EXE:record.exe}});delete processRegistry[name];saveJSON(processFile,processRegistry);}return;
  }
  await new Promise(resolve=>{c.once('exit',resolve);c.kill();setTimeout(resolve,3500).unref();});
  children.delete(name);
}
async function startCPA() {
  if(await probe(ports.cpa)){try{await cpaRequest('/v1/models');return;}catch{throw new Error('模型端口被其他服务占用，请关闭本工作台后重新打开。');}}
  if(!fs.existsSync(path.join(CPA,'cli-proxy-api.exe'))) throw new Error('CPA 还在下载，请稍等。');
  fs.mkdirSync(path.join(CPA,'auths'),{recursive:true});
  fs.writeFileSync(path.join(CPA,'config.yaml'),cpaConfig());
  launch('cpa',path.join(CPA,'cli-proxy-api.exe'),['--config',path.join(CPA,'config.yaml')],CPA);
  for(let i=0;i<20;i++){if(await probe(ports.cpa))return;await new Promise(r=>setTimeout(r,300));}
  throw new Error('CPA 未能启动，请查看下方运行记录。');
}
async function cpaRequest(endpoint,{management=false,method='GET',body,timeout=12000}={}) {
  const response=await fetch(`http://127.0.0.1:${ports.cpa}${endpoint}`,{method,headers:{Authorization:`Bearer ${management?settings.managementKey:settings.cpaKey}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(timeout)});
  const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{data={message:raw.slice(0,600)};}
  if(!response.ok) throw new Error(scrub(data.error?.message || data.error || data.message || `CPA 返回 ${response.status}`));
  return data;
}
async function runPython(args,env={}) {
  return new Promise((resolve,reject)=>{
    const p=spawn(PYTHON,args,{cwd:ASTR,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',ASTRBOT_ROOT:ASTR,...env},stdio:['ignore','pipe','pipe']});
    let output='';p.stdout.on('data',d=>{output+=d;log('astrbot',d.toString());});p.stderr.on('data',d=>{output+=d;log('astrbot',d.toString());});
    p.on('error',reject);p.on('exit',code=>code===0?resolve(output):reject(new Error('AstrBot 初始化失败，请查看运行记录。')));
  });
}
function applyAstrConfig() {
  const cfg=readJSON(ASTR_CONFIG); if(!cfg) throw new Error('AstrBot 配置尚未初始化。');
  fs.copyFileSync(ASTR_CONFIG,ASTR_CONFIG+'.backup');
  cfg.dashboard={...cfg.dashboard,host:'127.0.0.1',port:ports.astrbot};
  cfg.platform=(cfg.platform||[]).filter(p=>p.id!=='qqbot-local');
  cfg.platform.push({id:'qqbot-local',type:'aiocqhttp',enable:!!settings.botQQ&&settings.botConfirmed&&settings.enabled===true,ws_reverse_host:'127.0.0.1',ws_reverse_port:ports.onebot,ws_reverse_token:settings.botToken});
  cfg.platform_settings={...cfg.platform_settings,unique_session:true,enable_id_white_list:true,id_whitelist:settings.groupIds.length?settings.groupIds:['__no_group_configured__'],wl_ignore_admin_on_group:false,wl_ignore_admin_on_friend:false,reply_with_mention:true};
  cfg.provider_sources=(cfg.provider_sources||[]).filter(p=>p.id!=='cpa-local');
  cfg.provider_sources.push({id:'cpa-local',provider:'openai',type:'openai_chat_completion',provider_type:'chat_completion',enable:true,key:[settings.cpaKey],api_base:`http://127.0.0.1:${ports.cpa}/v1`,timeout:120,proxy:'',custom_headers:{}});
  cfg.provider=(cfg.provider||[]).filter(p=>p.id!=='cpa-qq-chat');
  if(settings.model) cfg.provider.push({id:'cpa-qq-chat',provider_source_id:'cpa-local',provider:'openai',type:'openai_chat_completion',provider_type:'chat_completion',enable:true,model:settings.model,model_config:{},custom_extra_body:{}});
  cfg.provider_settings={...cfg.provider_settings,enable:!!settings.model,computer_use_runtime:'none'};
  delete cfg.provider_settings.default_provider_id;
  cfg.agent_runner={...(cfg.agent_runner||{}),runner_type:'local',config:{...(cfg.agent_runner?.config||{}),model:{...(cfg.agent_runner?.config?.model||{}),provider_id:settings.model?'cpa-qq-chat':''}}};
  cfg.timezone='Asia/Shanghai';
  saveJSON(ASTR_CONFIG,cfg);
}
async function startAstrbot({restart=false}={}) {
  if(astrBusy) throw new Error('AstrBot 正在准备，请稍等。');
  const setup=readJSON(path.join(ROOT,'setup-status.json'));
  if(!setup?.ready) throw new Error('AstrBot 的依赖仍在安装，请稍等。');
  astrBusy=true;
  try {
    if(restart) await stop('astrbot');
    if(await probe(ports.astrbot)) return;
    if(!fs.existsSync(ASTR_CONFIG)) {
      await runPython(['-m','astrbot.cli','init','--yes'],{ASTRBOT_DASHBOARD_INITIAL_PASSWORD:settings.dashboardPassword});
    }
    applyAstrConfig();
    launch('astrbot',PYTHON,['-m','astrbot.cli','run'],ASTR,{ASTRBOT_ROOT:ASTR,ASTRBOT_DASHBOARD_INITIAL_PASSWORD:settings.dashboardPassword});
    for(let i=0;i<45;i++){if(await probe(ports.astrbot))return;const c=children.get('astrbot');if(c?.exitCode!==null)break;await new Promise(r=>setTimeout(r,500));}
    throw new Error('AstrBot 还未就绪，请查看运行记录。');
  } finally { astrBusy=false; }
}
async function getStatus() {
  const [cpa,astrbot,napcat,onebot]=await Promise.all([ports.cpa,ports.astrbot,ports.napcat,ports.onebot].map(probe));
  const astrlog=tail('astrbot',150);
  const connectAt=astrlog.lastIndexOf('适配器已连接');
  const disconnectAt=Math.max(astrlog.lastIndexOf('适配器已被关闭'),astrlog.lastIndexOf('WebSocket connection closed'));
  return {setup:readJSON(path.join(ROOT,'setup-status.json'),{phase:'waiting',message:'准备安装',ready:false}),
    services:{cpa,astrbot,napcat:napcat&&!!processRegistry.napcat,onebot,astrBusy,napcatBusy:napcatBridge.state().busy,qqVerified:napcatBridge.state().verified,qqConnected:napcatBridge.state().configured&&napcat&&onebot&&connectAt>disconnectAt&&connectAt!==-1},
    installed:{cpa:fs.existsSync(path.join(CPA,'cli-proxy-api.exe')),astrbot:fs.existsSync(path.join(ROOT,'.venv','Scripts','astrbot.exe'))},
    auth:{connected:credentialCount()>0,count:credentialCount(),waiting:!!auth.state,error:auth.error},
    settings:{model:settings.model,proxyUrl:settings.proxyUrl,groupIds:settings.groupIds,botQQ:settings.botQQ||'',botConfirmed:!!settings.botConfirmed,enabled:!!settings.enabled,testPassed:settings.testPassed},
    urls:{apiBase:`http://127.0.0.1:${ports.cpa}/v1`,ws:`ws://127.0.0.1:${ports.onebot}/ws`,astrbot:`http://127.0.0.1:${ports.astrbot}`,napcat:`http://127.0.0.1:${ports.napcat}`},ports,version:'0.1.0',napcatSetup:napcatBridge.state().setup,lastTest,now:new Date().toISOString()};
}
async function bodyJSON(req) { let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)throw new Error('提交内容过长。');}try{return raw?JSON.parse(raw):{};}catch{throw new Error('提交内容格式不正确，请重新操作。');} }
function json(res,code,data) { res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data)); }
const staticFiles={'/':'workbench.html','/style.css':'style.css','/app.js':'workbench.js'};
const server=http.createServer(async(req,res)=>{
  const host=req.headers.host;
  if(![`127.0.0.1:${PORT}`,`localhost:${PORT}`].includes(host)){json(res,403,{error:'此工作台仅允许本机访问。'});return;}
  const pathname=new URL(req.url,ORIGIN).pathname;
  try {
    if(pathname.startsWith('/api/')) {
      if(req.headers.origin && ![ORIGIN,`http://localhost:${PORT}`].includes(req.headers.origin))return json(res,403,{error:'来源不受支持。'});
      if(req.headers['x-qqbot-action']!=='local-control')return json(res,403,{error:'请从本机工作台操作。'});
      if(req.method==='GET' && pathname==='/api/status')return json(res,200,await getStatus());
      if(req.method==='GET' && pathname==='/api/logs')return json(res,200,{cpa:tail('cpa'),astrbot:tail('astrbot'),napcat:tail('napcat'),install:tail('install',25)});
      if(req.method==='GET' && pathname==='/api/models') { const d=await cpaRequest('/v1/models');return json(res,200,{models:(d.data||[]).map(m=>m.id).sort()}); }
      if(req.method!=='POST')return json(res,405,{error:'不支持的操作。'});
      const body=await bodyJSON(req);
      if(pathname==='/api/napcat/start'){await napcatBridge.start(body.isolated===true);return json(res,200,{ok:true});}
      if(pathname==='/api/napcat/password'){const result=await napcatBridge.passwordLogin(body.password);body.password='';return json(res,200,result||{ok:true});}
      if(pathname==='/api/napcat/native-url'){if(!processRegistry.napcat)throw new Error('请先启动本工作台的独立 QQ 组件。');return json(res,200,{url:`http://127.0.0.1:${ports.napcat}/webui?token=${encodeURIComponent(settings.qqWebToken)}`});}
      if(pathname==='/api/napcat/check')return json(res,200,await napcatBridge.check());
      if(pathname==='/api/napcat/stop'){await napcatBridge.stop();return json(res,200,{ok:true});}
      if(pathname==='/api/napcat/refresh-qr'){await napcatBridge.request('QQLogin/RefreshQRcode');return json(res,200,{ok:true});}
      if(pathname==='/api/napcat/qrcode'){const image=await napcatBridge.qrcode();return json(res,200,{image:image?'data:image/png;base64,'+image.toString('base64'):null});}
      if(pathname==='/api/setup/retry'){prepareEnvironment();return json(res,200,{ok:true});}
      if(pathname==='/api/cpa/start'){await startCPA();return json(res,200,{ok:true});}
      if(pathname==='/api/cpa/stop'){await stop('cpa');return json(res,200,{ok:true});}
      if(pathname==='/api/astrbot/start'){await startAstrbot();return json(res,200,{ok:true});}
      if(pathname==='/api/astrbot/stop'){await stop('astrbot');return json(res,200,{ok:true});}
      if(pathname==='/api/auth/start'){
        await startCPA();
        if(auth.state && Date.now()-auth.started<8*60000)return json(res,200,{url:auth.url});
        const d=await cpaRequest('/v0/management/codex-auth-url?is_webui=true',{management:true,timeout:25000});
        if(!d.url || !d.state)throw new Error('CPA 未返回登录地址。');
        const u=new URL(d.url);if(u.protocol!=='https:' || u.hostname!=='auth.openai.com')throw new Error('登录地址不符合预期，已停止。');
        auth={state:d.state,url:d.url,started:Date.now(),error:''};return json(res,200,{url:d.url});
      }
      if(pathname==='/api/auth/check'){
        if(!auth.state)return json(res,200,{connected:credentialCount()>0});
        if(Date.now()-auth.started>10*60000){auth={state:'',url:'',started:0,error:'授权已超时，请重新发起登录。'};return json(res,200,{connected:false,error:auth.error});}
        const d=await cpaRequest('/v0/management/get-auth-status?state='+encodeURIComponent(auth.state),{management:true});
        if(d.status==='error'){auth.error=scrub(d.error||'登录未完成');auth.state='';}
        if(d.status==='ok'){auth.state='';auth.url='';if(!credentialCount())auth.error='未检测到有效凭据，请重新登录。';}
        return json(res,200,{connected:credentialCount()>0,waiting:!!auth.state,error:auth.error});
      }
      if(pathname==='/api/settings'){
        const next=structuredClone(settings);
        if(body.proxyUrl!==undefined){const p=String(body.proxyUrl).trim();if(p){const u=new URL(p);if(!['http:','https:','socks5:'].includes(u.protocol))throw new Error('代理地址须以 http://、https:// 或 socks5:// 开头。');}next.proxyUrl=p;}
        if(body.model!==undefined){if(typeof body.model!=='string'||body.model.length>160)throw new Error('模型名称不正确。');if(next.model!==body.model)next.testPassed=false;next.model=body.model;}
        if(body.groupIds!==undefined){const groups=String(body.groupIds).split(/[\s,，;；]+/).filter(Boolean);if(groups.some(g=>!/^\d{5,12}$/.test(g)))throw new Error('请输入有效的 QQ 群号。');next.groupIds=[...new Set(groups)];}
        if(body.botQQ!==undefined){const qq=String(body.botQQ).trim();if(!/^\d{5,12}$/.test(qq))throw new Error('请输入独立机器人 QQ 号。');if(body.botConfirmed!==true)throw new Error('请确认这是单独准备的机器人账号。');if(processRegistry.napcat&&qq!==settings.botQQ)throw new Error('请先停止本工作台的 QQ 组件，再切换机器人账号。');next.botQQ=qq;next.botConfirmed=true;}
        settings=next;
        saveJSON(settingsFile,settings);
        if(body.proxyUrl!==undefined){await stop('cpa');await startCPA();}
        if(fs.existsSync(ASTR_CONFIG)){
          const running=await probe(ports.astrbot);if(running)await stop('astrbot');applyAstrConfig();if(running)await startAstrbot();
        }
        return json(res,200,{ok:true});
      }
      if(pathname==='/api/model/test'){
        if(!settings.model)throw new Error('请先选择并保存模型。');
        const before=Date.now();
        try {const d=await cpaRequest('/v1/chat/completions',{method:'POST',timeout:120000,body:{model:settings.model,messages:[{role:'user',content:'这是一次连接测试。请只用一句中文确认你可以正常回复。'}],stream:false}});
          const answer=d.choices?.[0]?.message?.content;if(!answer)throw new Error('模型没有返回文字。');
          settings.testPassed=true;saveJSON(settingsFile,settings);lastTest={success:true,answer:String(answer).slice(0,3000),elapsed:Date.now()-before,time:new Date().toISOString()};return json(res,200,lastTest);
        }catch(e){lastTest={success:false,error:scrub(e.message),time:new Date().toISOString()};throw e;}
      }
      if(pathname==='/api/model/auto'){
        const d=await cpaRequest('/v1/models');const ids=(d.data||[]).map(m=>m.id).filter(id=>/^gpt-/i.test(id)&&!/(image|audio|realtime|tts|whisper)/i.test(id));
        if(!ids.length)throw new Error('账号暂未返回可用 GPT 模型，请稍后刷新或在高级配置中手动选择。');
        settings.model=ids.find(id=>/^gpt-6-luna$/i.test(id))||ids.find(id=>/mini|luna/i.test(id))||ids[0];settings.testPassed=false;saveJSON(settingsFile,settings);
        return json(res,200,{model:settings.model});
      }
      if(pathname==='/api/activate'){
        if(!credentialCount())throw new Error('请先完成 ChatGPT 登录。');
        if(!settings.model||!settings.testPassed)throw new Error('请先等待模型连接测试通过。');
        if(!settings.groupIds.length)throw new Error('请输入目标 QQ 群号。');
        if(!napcatBridge.state().verified)throw new Error('请先完成独立机器人 QQ 登录。');
        settings.enabled=true;saveJSON(settingsFile,settings);
        if(await probe(ports.astrbot))await stop('astrbot');
        await startAstrbot();const connected=await napcatBridge.check();return json(res,200,connected);
      }
      if(pathname==='/api/connection')return json(res,200,{url:`ws://127.0.0.1:${ports.onebot}/ws`,token:settings.botToken,apiBase:`http://127.0.0.1:${ports.cpa}/v1`,apiKey:settings.cpaKey,dashboardUser:'astrbot',dashboardPassword:settings.dashboardPassword});
      if(pathname==='/api/shutdown'){json(res,200,{ok:true});setImmediate(shutdown);return;}
      return json(res,404,{error:'没有这个操作。'});
    }
    if(req.method!=='GET'||!staticFiles[pathname])return json(res,404,{error:'页面不存在。'});
    const name=staticFiles[pathname];const type=name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html';
    res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'self'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    fs.createReadStream(path.join(APP,'public',name)).pipe(res);
  }catch(e){json(res,400,{error:scrub(e.message||'操作未完成，请重试。')});}
});
server.listen(PORT,'127.0.0.1',()=>{fs.writeFileSync(path.join(STATE,'server.pid'),String(process.pid));saveJSON(path.join(STATE,'workbench.json'),{url:ORIGIN,pid:process.pid,version:'0.1.0'});console.log(`QQBot 工作台：${ORIGIN}`);if(process.env.QQBOT_SKIP_BOOTSTRAP!=='1')prepareEnvironment();});
server.on('error',e=>{console.error(e.message);process.exitCode=1;});
async function shutdown(){if(shuttingDown)return;shuttingDown=true;for(const child of toolProcesses)child.kill();await stop('astrbot');await stop('napcat');await stop('cpa');server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),4000).unref();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
