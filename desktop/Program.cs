using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("QQBot Workbench")]
[assembly: AssemblyProduct("群聊实验室")]
[assembly: AssemblyVersion("0.1.0.0")]
[assembly: AssemblyFileVersion("0.1.0.0")]

internal static class Program
{
    internal static string Root;
    internal static string Url;
    internal static Process Backend;
    internal static bool Smoke;
    internal static Mutex InstanceMutex;
    internal const string Version = "0.1.0";
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    private static extern bool SetDllDirectory(string path);

    [STAThread]
    private static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "QQBotWorkbench");
        for (int i=0;i<args.Length;i++)
        {
            if(args[i]=="--data-dir" && i+1<args.Length) Root=Path.GetFullPath(args[++i]);
            if(args[i]=="--smoke-test") Smoke=true;
        }
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(Path.Combine(Root,"logs"));
        bool created;
        using(var hash=SHA256.Create())
        {
            string suffix=BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Root))).Replace("-","").Substring(0,16);
            InstanceMutex=new Mutex(true,"Local\\QQBotWorkbench-"+suffix,out created);
        }
        if(!created)
        {
            MessageBox.Show("工作台已经在运行，请从系统托盘打开。","群聊实验室",MessageBoxButtons.OK,MessageBoxIcon.Information);
            return 0;
        }
        try
        {
            ExtractPayload();
            SetDllDirectory(Path.Combine(Root,"runtime"));
            AppDomain.CurrentDomain.AssemblyResolve += delegate(object sender,ResolveEventArgs e)
            {
                string name=new AssemblyName(e.Name).Name+".dll";
                string target=Path.Combine(Root,"runtime",name);
                return File.Exists(target)?Assembly.LoadFrom(target):null;
            };
            StartBackend();
            if(Smoke)
            {
                string data=Get("/api/status");
                File.WriteAllText(Path.Combine(Root,"smoke-result.json"),data,Encoding.UTF8);
                Shutdown();return 0;
            }
            RunWindow();return 0;
        }
        catch(Exception e)
        {
            File.WriteAllText(Path.Combine(Root,"logs","desktop-error.log"),e.ToString(),Encoding.UTF8);
            if(!Smoke)MessageBox.Show("工作台未能启动："+e.Message+"\n\n日志目录："+Path.Combine(Root,"logs"),"群聊实验室",MessageBoxButtons.OK,MessageBoxIcon.Error);
            Shutdown();return 1;
        }
        finally {if(InstanceMutex!=null)InstanceMutex.Dispose();}
    }
    private static void ExtractPayload()
    {
        string stamp=Path.Combine(Root,"app-version.txt");
        string build=Assembly.GetExecutingAssembly().GetName().Version.ToString();
        if(File.Exists(stamp)&&File.ReadAllText(stamp)==build&&File.Exists(Path.Combine(Root,"app","src","server.mjs")))return;
        using(Stream source=Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip"))
        using(var archive=new ZipArchive(source,ZipArchiveMode.Read))
        {
            string allowed=Path.GetFullPath(Root)+Path.DirectorySeparatorChar;
            foreach(ZipArchiveEntry entry in archive.Entries)
            {
                string target=Path.GetFullPath(Path.Combine(Root,entry.FullName));
                if(!target.StartsWith(allowed,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("安装包包含无效路径。");
                if(entry.FullName.EndsWith("/")){Directory.CreateDirectory(target);continue;}
                Directory.CreateDirectory(Path.GetDirectoryName(target));
                using(Stream input=entry.Open())using(Stream output=File.Create(target))input.CopyTo(output);
            }
        }
        File.WriteAllText(stamp,build,Encoding.UTF8);
    }
    private static int FreePort()
    {
        var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();int port=((IPEndPoint)listener.LocalEndpoint).Port;listener.Stop();return port;
    }
    private static void StartBackend()
    {
        Url="http://127.0.0.1:"+FreePort().ToString();
        var start=new ProcessStartInfo(Path.Combine(Root,"runtime","node.exe"));
        start.Arguments="\""+Path.Combine(Root,"app","src","server.mjs")+"\"";
        start.WorkingDirectory=Path.Combine(Root,"app");
        start.UseShellExecute=false;start.CreateNoWindow=true;
        start.RedirectStandardOutput=true;start.RedirectStandardError=true;
        start.StandardOutputEncoding=Encoding.UTF8;start.StandardErrorEncoding=Encoding.UTF8;
        start.EnvironmentVariables["QQBOT_DATA_DIR"]=Path.Combine(Root,"data");
        start.EnvironmentVariables["QQBOT_RUNTIME_DIR"]=Path.Combine(Root,"runtime");
        start.EnvironmentVariables["QQBOT_PORT"]=new Uri(Url).Port.ToString();
        if(Smoke)start.EnvironmentVariables["QQBOT_SKIP_BOOTSTRAP"]="1";
        Backend=new Process();Backend.StartInfo=start;
        Backend.OutputDataReceived+=delegate(object s,DataReceivedEventArgs e){if(e.Data!=null)AppendDesktopLog(e.Data);};
        Backend.ErrorDataReceived+=delegate(object s,DataReceivedEventArgs e){if(e.Data!=null)AppendDesktopLog(e.Data);};
        Backend.Start();Backend.BeginOutputReadLine();Backend.BeginErrorReadLine();
        for(int i=0;i<100;i++)
        {
            if(Backend.HasExited)throw new Exception("本机服务启动失败，请查看 desktop.log。");
            try{Get("/api/status");return;}catch(WebException){Thread.Sleep(150);}
        }
        throw new Exception("本机服务未在预期时间内响应。");
    }
    internal static string Get(string route)
    {
        var request=(HttpWebRequest)WebRequest.Create(Url+route);request.Proxy=null;request.Timeout=2500;
        request.Headers["X-QQBot-Action"]="local-control";
        using(var response=request.GetResponse())using(var reader=new StreamReader(response.GetResponseStream(),Encoding.UTF8))return reader.ReadToEnd();
    }
    private static readonly object LogLock=new object();
    private static void AppendDesktopLog(string text){lock(LogLock){File.AppendAllText(Path.Combine(Root,"logs","desktop.log"),DateTime.Now.ToString("s")+" "+text+Environment.NewLine,Encoding.UTF8);}}
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static void RunWindow(){Application.Run(new WorkbenchWindow());}
    internal static void OpenBrowser(string url)
    {
        Uri uri;if(!Uri.TryCreate(url,UriKind.Absolute,out uri)||!(uri.Scheme=="https"||uri.Scheme=="http"))return;
        Process.Start(new ProcessStartInfo(url){UseShellExecute=true});
    }
    internal static void Shutdown()
    {
        try
        {
            if(Backend==null||Backend.HasExited)return;
            var request=(HttpWebRequest)WebRequest.Create(Url+"/api/shutdown");request.Proxy=null;request.Method="POST";request.Timeout=6000;request.Headers["X-QQBot-Action"]="local-control";request.ContentType="application/json";
            byte[] data=Encoding.UTF8.GetBytes("{}");request.ContentLength=data.Length;
            using(var stream=request.GetRequestStream())stream.Write(data,0,data.Length);
            using(var response=request.GetResponse()){}
            if(!Backend.WaitForExit(7000))Backend.Kill();
        }catch{try{if(Backend!=null&&!Backend.HasExited)Backend.Kill();}catch{}}
    }
}

internal sealed class WorkbenchWindow:Form
{
    private readonly WebView2 view=new WebView2();
    private readonly NotifyIcon tray=new NotifyIcon();
    private readonly Label loading=new Label();
    private bool exitRequested;
    public WorkbenchWindow()
    {
        Text="群聊实验室 · QQBot Workbench";ClientSize=new Size(1160,800);MinimumSize=new Size(530,650);StartPosition=FormStartPosition.CenterScreen;
        BackColor=Color.FromArgb(245,247,245);
        string icon=Path.Combine(Program.Root,"app","icon.ico");if(File.Exists(icon))Icon=new Icon(icon);
        loading.Dock=DockStyle.Fill;loading.Text="正在打开你的机器人工作台…";loading.TextAlign=ContentAlignment.MiddleCenter;loading.Font=new Font("Microsoft YaHei UI",12);
        Controls.Add(loading);view.Dock=DockStyle.Fill;Controls.Add(view);view.Visible=false;
        var menu=new ContextMenuStrip();menu.Items.Add("显示工作台",null,delegate{ShowWorkbench();});menu.Items.Add("退出并停止机器人",null,delegate{exitRequested=true;Close();});
        tray.Icon=Icon;tray.Text="群聊实验室 · 机器人工作台";tray.ContextMenuStrip=menu;tray.Visible=true;tray.DoubleClick+=delegate{ShowWorkbench();};
        Shown+=OnShown;FormClosing+=OnClosing;
    }
    private void ShowWorkbench(){Show();WindowState=FormWindowState.Normal;Activate();}
    private async void OnShown(object sender,EventArgs e)
    {
        try
        {
            var environment=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Program.Root,"browser-profile"));
            await view.EnsureCoreWebView2Async(environment);
            view.CoreWebView2.NewWindowRequested+=delegate(object s,CoreWebView2NewWindowRequestedEventArgs a){a.Handled=true;Program.OpenBrowser(a.Uri);};
            view.CoreWebView2.NavigationStarting+=delegate(object s,CoreWebView2NavigationStartingEventArgs a)
            {
                if(!a.Uri.StartsWith(Program.Url+"/",StringComparison.OrdinalIgnoreCase)){a.Cancel=true;Program.OpenBrowser(a.Uri);}
            };
            view.CoreWebView2.NavigationCompleted+=delegate(object s,CoreWebView2NavigationCompletedEventArgs a)
            {
                File.WriteAllText(Path.Combine(Program.Root,"webview-ready.json"),"{\"success\":"+(a.IsSuccess?"true":"false")+"}",Encoding.UTF8);
                if(a.IsSuccess){view.Visible=true;loading.Visible=false;}else{loading.Text="页面加载失败，可以从托盘重新打开工作台。";}
            };
            view.Source=new Uri(Program.Url+"/");
        }
        catch(Exception ex)
        {
            loading.Text="此电脑的 WebView2 暂不可用，已在默认浏览器打开工作台。\n关闭窗口后，工作台会留在系统托盘。";
            File.WriteAllText(Path.Combine(Program.Root,"logs","webview-error.log"),ex.ToString(),Encoding.UTF8);
            Program.OpenBrowser(Program.Url);
        }
    }
    private async void OnClosing(object sender,FormClosingEventArgs e)
    {
        if(!exitRequested&&e.CloseReason==CloseReason.UserClosing){e.Cancel=true;Hide();return;}
        if(!exitRequested){exitRequested=true;e.Cancel=true;Enabled=false;await Task.Run((Action)Program.Shutdown);tray.Visible=false;tray.Dispose();Close();return;}
        Program.Shutdown();tray.Visible=false;tray.Dispose();
    }
}
