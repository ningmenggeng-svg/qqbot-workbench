const $=id=>document.getElementById(id);
let status,initialized=false,refreshing=false,authPolling=false,qqPolling=false,autoBusy=false,autoAttempted=false,models=[],logType='cpa';
const pending=new Set();
async function api(route,body){const r=await fetch('/api/'+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-QQBot-Action':'local-control'},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'操作未完成。');return d;}
let toastTimer;
function toast(text,error=false){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?10000:4000);}
function enable(id,value){if(!pending.has(id))$(id).disabled=!value;}
async function action(button,fn){if(pending.has(button.id))return;pending.add(button.id);const old=button.textContent;button.disabled=true;button.textContent='处理中…';button.setAttribute('aria-busy','true');try{await fn();}catch(e){toast(e.message,true);}finally{pending.delete(button.id);button.textContent=old;button.disabled=false;button.removeAttribute('aria-busy');await refresh();}}
function badge(id,text,ok=false,wait=false){$(id).textContent=text;$(id).className=(id.startsWith('node-')?'node-status':'badge')+(ok?' ok':wait?' wait':'');}
function render(s){
  status=s;const v=s.services,a=s.auth,c=s.settings;
  if(!initialized){$('bot-qq').value=c.botQQ;$('groups').value=c.groupIds.join(', ');$('proxy').value=c.proxyUrl;initialized=true;}
  $('map-group').textContent=c.groupIds.length?c.groupIds.join(' / '):'尚未设置';$('map-bot').textContent=c.botQQ||'独立机器人账号';
  badge('node-qq',v.qqConnected?'已连接':c.enabled?'连接中':'待启用',v.qqConnected);
  badge('node-napcat',v.qqVerified?'已登录':v.napcatBusy?'准备中':v.napcat?'等待登录':'待登录',v.qqVerified);
  badge('node-astrbot',v.astrbot?'运行中':s.installed.astrbot?'已准备':'安装中',v.astrbot);
  badge('node-cpa',c.testPassed?'测试通过':a.connected?'已授权':'待登录',a.connected);
  badge('qq-badge',v.qqVerified?'账号已核验':v.napcatBusy?'准备中':v.napcat?'等待登录':'待登录',v.qqVerified,v.napcat);
  badge('account-badge',c.testPassed?'模型已就绪':a.connected?'已授权':a.waiting?'等待授权':'待授权',a.connected,a.waiting);
  badge('group-badge',v.qqConnected?'已连接':c.enabled?'连接中':c.groupIds.length?'群号已保存':'待设置',v.qqConnected);
  $('setup-title').textContent=s.setup.ready?'运行环境已准备好':s.setup.phase==='error'?'准备过程需要重试':'正在自动准备运行环境';$('setup-description').textContent=s.setup.message;$('setup-badge').textContent=s.setup.ready?'已就绪':s.setup.phase==='error'?'未完成':'安装中';$('setup-banner').className='setup-banner'+(s.setup.ready?' complete':s.setup.phase==='error'?' error':'');$('retry-setup').hidden=s.setup.phase!=='error';
  $('auth-success').hidden=!a.connected;
  if(!pending.has('login'))$('login').textContent=a.connected?'重新登录 ChatGPT ↗':a.waiting?'继续完成授权 ↗':'登录 ChatGPT ↗';enable('login',s.installed.cpa);
  $('auth-hint').textContent=a.error||(a.waiting?'在 OpenAI 页面完成授权后，工作台会自动检测。':a.connected?'使用该账号的 Codex 可用额度；与 OpenAI API 余额分开。':'使用该账号可用的 Codex 套餐额度，具体限额由上游决定。');
  for(const n of ['cpa','astrbot','napcat'])$(n+'-dot').className='service-dot'+(v[n]?' ok':'');
  $('service-count').textContent=[v.cpa,v.astrbot,v.napcat].filter(Boolean).length+' / 3 在线';
  $('cpa-port').textContent='模型接口 · '+s.ports.cpa;$('astrbot-port').textContent='聊天助手 · '+s.ports.astrbot;$('napcat-port').textContent='QQ 小号 · '+s.ports.napcat;
  if(!pending.has('toggle-cpa'))$('toggle-cpa').textContent=v.cpa?'停止':'启动';enable('toggle-cpa',s.installed.cpa);
  if(!pending.has('toggle-astrbot'))$('toggle-astrbot').textContent=v.astrbot?'停止':'启动';enable('toggle-astrbot',s.setup.ready&&!v.astrBusy);
  $('napcat-label').textContent=v.qqVerified?'已登录':v.napcat?'等待登录':'待登录';$('qq-stop').hidden=!v.napcat;
  enable('qq-password-login',!v.napcatBusy);enable('qq-qr-login',!v.napcatBusy);
  if(v.qqVerified){$('qq-message').textContent='✓ 独立机器人账号已核验：'+c.botQQ;$('qr-box').hidden=true;}else if(!pending.has('qq-password-login')&&!pending.has('qq-qr-login'))$('qq-message').textContent=s.napcatSetup.message;
  $('astrbot-link').href=s.urls.astrbot;$('astrbot-link').target='_blank';$('astrbot-link').rel='noopener noreferrer';
  enable('load-models',a.connected&&v.cpa);enable('model',a.connected&&models.length);enable('save-model',a.connected&&$('model').value);enable('test-model',a.connected&&c.model);
  $('group-success').hidden=!v.qqConnected;
  const count=[v.qqVerified,a.connected,v.qqConnected].filter(Boolean).length;$('step-count').textContent=count+' / 3 步已完成';$('step-progress').value=count;
  const next=!v.qqVerified?['登录独立 QQ 小号','填写机器人账号，使用密码或扫码完成登录。']:!a.connected?['连接你的 ChatGPT','在 OpenAI 页面登录，程序会自动检测模型连接。']:!c.testPassed?['正在准备聊天模型','等待自动选择和测试，也可在高级配置中选择模型。']:!v.qqConnected?['输入群号并启用','把小号加入目标群，填写群号后点击启用群聊。']:['去群里打个招呼','在目标群里 @机器人，开始第一段对话。'];$('next-title').textContent=next[0];$('next-description').textContent=next[1];$('journey-label').textContent=v.qqConnected?'群聊连接已就绪':next[0];
  $('last-update').textContent='刚刚更新 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  if(s.lastTest){const t=s.lastTest;$('test-result').hidden=false;$('test-result').className='test-result'+(t.success?'':' error');$('test-result').textContent=t.success?'✓ 模型测试通过 · '+(t.elapsed/1000).toFixed(1)+' 秒\n\n'+t.answer:'模型测试未完成\n'+t.error;}
  if(a.connected&&!autoAttempted&&!autoBusy){autoAttempted=true;autoModel().catch(e=>toast(e.message,true));}
}
async function refresh(){if(refreshing)return;refreshing=true;try{render(await api('status'));if(status.auth.waiting&&!authPolling){authPolling=true;try{await api('auth/check',{});}catch(e){$('auth-hint').textContent=e.message;}finally{authPolling=false;}}if(status.services.napcat&&!status.services.qqVerified&&!qqPolling){qqPolling=true;try{const d=await api('napcat/check',{});if(d.verified)toast('机器人 QQ 账号已核验。');}catch(e){$('qq-message').textContent=e.message;}finally{qqPolling=false;}}}catch(e){$('last-update').textContent='本机工作台暂未连接，请重新打开程序。';}finally{refreshing=false;}}
async function loadModels(){const d=await api('models');models=d.models;$('model').replaceChildren();for(const id of models){const option=document.createElement('option');option.value=id;option.textContent=id;$('model').append(option);}if(models.includes(status.settings.model))$('model').value=status.settings.model;if(!models.length){const option=document.createElement('option');option.textContent='暂未返回可用模型';option.value='';$('model').append(option);}enable('model',models.length);enable('save-model',models.length);}
async function autoModel(){autoBusy=true;try{await loadModels();if(!status.settings.model)await api('model/auto',{});if(!status.settings.testPassed){$('test-result').hidden=false;$('test-result').textContent='正在自动检测模型连接，请稍等…';await api('model/test',{});}await refresh();await loadModels();}finally{autoBusy=false;}}
async function saveBot(){const qq=$('bot-qq').value.trim();if(!/^\d{5,12}$/.test(qq))throw new Error('请输入独立机器人 QQ 号。');if(!$('dedicated').checked)throw new Error('请确认独立机器人账号与运行环境。');await api('settings',{botQQ:qq,botConfirmed:true});}
async function showQR(){const d=await api('napcat/qrcode',{});$('qr-box').hidden=false;if(d.image){$('qq-qr-image').src=d.image;$('qq-qr-image').hidden=false;$('qr-hint').textContent='请使用指定的小号扫码登录。';}else{$('qr-hint').textContent='二维码正在生成，请稍后点刷新。';}}
$('qq-password-login').addEventListener('click',()=>action($('qq-password-login'),async()=>{let password=$('bot-password').value;if(!password)throw new Error('请输入小号密码，或选择扫码登录。');$('bot-password').value='';await saveBot();$('qq-message').textContent='正在准备 QQ 组件，首次使用需要下载约 118 MB…';await api('napcat/start',{isolated:$('dedicated').checked});try{const d=await api('napcat/password',{password});if(d.needCaptcha||d.needNewDevice){$('qq-message').textContent='腾讯要求额外安全验证，请改用扫码，或打开 QQ 组件面板完成。';const link=await api('napcat/native-url',{});$('qq-native').href=link.url;$('qq-native').hidden=false;}else toast('已提交登录，正在等待腾讯确认。');}finally{password='';}}));
$('qq-qr-login').addEventListener('click',()=>action($('qq-qr-login'),async()=>{await saveBot();$('qq-message').textContent='正在准备 QQ 组件，首次使用需要下载约 118 MB…';await api('napcat/start',{isolated:$('dedicated').checked});await showQR();}));
$('refresh-qr').addEventListener('click',()=>action($('refresh-qr'),async()=>{await api('napcat/refresh-qr',{});await showQR();}));
$('qq-stop').addEventListener('click',()=>action($('qq-stop'),async()=>{await api('napcat/stop',{});toast('本工作台的机器人已停止。');}));
$('login').addEventListener('click',()=>action($('login'),async()=>{const d=await api('auth/start',{});$('auth-link').href=d.url;$('auth-link').hidden=false;window.open(d.url,'_blank','noopener,noreferrer');toast('请在 OpenAI 官方页面完成登录授权。');}));
$('activate').addEventListener('click',()=>action($('activate'),async()=>{await api('settings',{groupIds:$('groups').value});await api('activate',{});toast('群聊连接已配置，等待连接就绪。');}));
$('save-groups').addEventListener('click',()=>action($('save-groups'),async()=>{await api('settings',{groupIds:$('groups').value});toast('群号已保存。');}));
$('save-proxy').addEventListener('click',()=>action($('save-proxy'),async()=>{await api('settings',{proxyUrl:$('proxy').value});autoAttempted=false;toast('网络设置已保存，CPA 已重启。');}));
$('refresh').addEventListener('click',()=>action($('refresh'),refresh));
$('retry-setup').addEventListener('click',()=>action($('retry-setup'),async()=>{await api('setup/retry',{});toast('已重新开始准备环境。');}));
$('toggle-cpa').addEventListener('click',()=>action($('toggle-cpa'),()=>api('cpa/'+(status.services.cpa?'stop':'start'),{})));
$('toggle-astrbot').addEventListener('click',()=>action($('toggle-astrbot'),()=>api('astrbot/'+(status.services.astrbot?'stop':'start'),{})));
$('load-models').addEventListener('click',()=>action($('load-models'),loadModels));$('model').addEventListener('change',()=>enable('save-model',$('model').value));
$('save-model').addEventListener('click',()=>action($('save-model'),async()=>{await api('settings',{model:$('model').value});toast('模型已保存。');}));
$('test-model').addEventListener('click',()=>action($('test-model'),async()=>{$('test-result').hidden=false;$('test-result').textContent='正在等待模型回复…';await api('model/test',{});}));
for(const b of document.querySelectorAll('[data-copy]'))b.addEventListener('click',()=>action(b,async()=>{const d=await api('connection',{});await navigator.clipboard.writeText(d[b.dataset.copy]);toast('已复制。');}));
async function loadLogs(){const d=await api('logs');$('log-output').textContent=d[logType]||'暂时没有运行记录。';}
for(const b of document.querySelectorAll('[data-log]'))b.addEventListener('click',async()=>{logType=b.dataset.log;for(const other of document.querySelectorAll('[data-log]')){other.classList.toggle('selected',other===b);other.setAttribute('aria-selected',String(other===b));}try{await loadLogs();}catch(e){toast(e.message,true);}});
$('logs').querySelector('details').addEventListener('toggle',e=>{if(e.target.open)loadLogs().catch(e=>toast(e.message,true));});$('refresh-logs').addEventListener('click',()=>action($('refresh-logs'),loadLogs));
refresh();setInterval(refresh,4000);
