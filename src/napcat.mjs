import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export function requireBotIdentity(settings,isolated) {
  if(!/^\d{5,12}$/.test(settings.botQQ||'')||!settings.botConfirmed)throw new Error('请填写单独准备的机器人 QQ 号，并确认该账号不是主号。');
  if(!isolated)throw new Error('请确认在独立 Windows 用户或专用电脑运行，以隔离日常 QQ 数据。');
}

export function createNapcatBridge({root,ports,getSettings,runTool,unpack,launch,stop,probe,owned,startAstrbot,saveJSON,readJSON}) {
  const app=path.join(root,'apps','napcat');
  const work=path.join(root,'napcat-workspace');
  const statusFile=path.join(root,'napcat-status.json');
  let busy=false,credential='',verified=false,configured=false;
  const state=()=>({busy,verified,configured,setup:readJSON(statusFile,{phase:'waiting',message:'填写独立机器人 QQ 号后登录。'})});
  const write=(phase,message)=>saveJSON(statusFile,{phase,message});
  const config=enable=>({network:{httpServers:[],httpSseServers:[],httpClients:[],websocketServers:[],websocketClients:enable?[{name:'qqbot-workbench',enable:true,url:`ws://127.0.0.1:${ports.onebot}/ws`,messagePostFormat:'array',reportSelfMessage:false,reconnectInterval:5000,token:getSettings().botToken,debug:false,heartInterval:30000}]:[],plugins:[]},musicSignUrl:'',enableLocalFile2Url:false,parseMultMsg:false,imageDownloadProxy:''});
  async function download(){
    const dest=path.join(root,'downloads','NapCat.Shell.Windows.Node.zip');
    const expected='51fbb10e7bcd56b0c2a6de86c37811e7518330e48a137ac689ab1e4d8627d3f0';
    const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    if(fs.existsSync(dest)&&hash(dest)===expected)return dest;
    fs.mkdirSync(path.dirname(dest),{recursive:true});
    const response=await fetch('https://github.com/NapNeko/NapCatQQ/releases/download/v4.18.41/NapCat.Shell.Windows.Node.zip',{signal:AbortSignal.timeout(600000)});
    if(!response.ok)throw new Error(`QQ 官方组件下载失败（${response.status}），请检查网络后重试。`);
    await pipeline(Readable.fromWeb(response.body),fs.createWriteStream(dest+'.part'));
    if(hash(dest+'.part')!==expected)throw new Error('QQ 官方组件校验失败，已停止。');
    fs.renameSync(dest+'.part',dest);return dest;
  }
  async function start(isolated){
    const settings=getSettings();requireBotIdentity(settings,isolated);
    if(busy)throw new Error('QQ 组件正在准备，请稍等。');
    const count=await runTool('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$taskSession=(Get-Process -Id $PID).SessionId; Write-Output (@(Get-Process -Name QQ -ErrorAction SilentlyContinue | Where-Object {$_.SessionId -eq $taskSession})).Count"],{name:'napcat'});
    if(Number(count.trim())>0)throw new Error('当前 Windows 会话已有 QQ 运行。请在独立 Windows 用户或专用电脑运行机器人；程序不会关闭现有 QQ。');
    if(await probe(ports.napcat)){if(owned())return;throw new Error('QQ 面板端口被其他程序占用，工作台不会接管现有 QQ。');}
    busy=true;credential='';verified=false;configured=false;
    try{
      if(!fs.existsSync(path.join(app,'index.js'))){write('download','正在从 NapCat 官方下载 QQ 组件（约 118 MB）');await unpack(await download(),app);}
      fs.mkdirSync(path.join(work,'config'),{recursive:true});
      saveJSON(path.join(work,'config','webui.json'),{host:'127.0.0.1',port:ports.napcat,token:settings.qqWebToken,autoLoginAccount:'',disableWebUI:false});
      saveJSON(path.join(work,'config',`onebot11_${settings.botQQ}.json`),config(false));
      write('login','请使用指定的独立机器人账号扫码登录。');
      launch('napcat',path.join(app,'node.exe'),['index.js','--qq',settings.botQQ],app,{NAPCAT_WORKDIR:work,NAPCAT_WEBUI_SECRET_KEY:settings.qqWebToken,NAPCAT_WEBUI_PREFERRED_PORT:String(ports.napcat),NAPCAT_QUICK_ACCOUNT:undefined,NAPCAT_QUICK_PASSWORD:undefined,NAPCAT_QUICK_PASSWORD_MD5:undefined});
      for(let i=0;i<60;i++){if(await probe(ports.napcat))return;await new Promise(r=>setTimeout(r,500));}
      throw new Error('QQ 组件还未就绪，请查看运行记录。');
    }catch(e){write('error',e.message);throw e;}finally{busy=false;}
  }
  async function request(endpoint,body={}){
    if(!owned())throw new Error('本工作台的独立 QQ 组件尚未启动。');
    if(!credential){
      const hash=crypto.createHash('sha256').update(getSettings().qqWebToken+'.napcat').digest('hex');
      const r=await fetch(`http://127.0.0.1:${ports.napcat}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({hash}),signal:AbortSignal.timeout(8000)});
      const d=await r.json();if(d.code!==0||!d.data?.Credential)throw new Error('QQ 面板还在启动，请稍后重试。');credential=d.data.Credential;
    }
    const r=await fetch(`http://127.0.0.1:${ports.napcat}/api/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
    const d=await r.json();if(d.code!==0){credential='';throw new Error(d.message||'QQ 请求未完成。');}return d.data;
  }
  async function check(){
    if(!owned()||!await probe(ports.napcat))return {online:false,verified:false};
    const login=await request('QQLogin/CheckLoginStatus');
    if(!login.isLogin){verified=false;configured=false;return {online:false,verified:false,phase:login.loginPhase,error:login.loginError||''};}
    const info=await request('QQLogin/GetQQLoginInfo');
    if(String(info.uin||'')!==getSettings().botQQ){await stop('napcat');verified=false;configured=false;throw new Error('登录账号与指定机器人号不一致，已停止本工作台的 QQ 组件。');}
    verified=true;
    if(!getSettings().enabled||!getSettings().model||!getSettings().groupIds?.length)return {online:true,verified:true,uin:getSettings().botQQ,configured:false};
    if(!configured){await startAstrbot();await request('OB11Config/SetConfig',{config:JSON.stringify(config(true))});configured=true;write('ready','机器人账号已核验，群聊连接已配置。');}
    return {online:true,verified:true,uin:getSettings().botQQ,configured};
  }
  async function qrcode(){await request('QQLogin/GetQQLoginQrcode');const file=path.join(work,'cache','qrcode.png');if(fs.existsSync(file))return fs.readFileSync(file);return null;}
  async function passwordLogin(password){
    if(typeof password!=='string'||!password||password.length>128)throw new Error('请输入 QQ 小号密码。');
    const passwordMd5=crypto.createHash('md5').update(password,'utf8').digest('hex');
    return request('QQLogin/PasswordLogin',{uin:getSettings().botQQ,passwordMd5});
  }
  return {start,check,qrcode,passwordLogin,state,request,stop:async()=>{await stop('napcat');credential='';verified=false;configured=false;write('stopped','QQ 组件已停止。');}};
}
