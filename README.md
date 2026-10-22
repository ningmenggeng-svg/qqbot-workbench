# 群聊实验室 · QQBot Workbench

Windows 本机 QQ 群 AI 助手工作台。登录独立 QQ 机器人账号、登录自己的 ChatGPT，再填写目标群号，程序负责准备 CPA、AstrBot、NapCat 与连接配置。

**当前版本：0.1.0 预览版。** Windows 10/11 x64。首次运行需要联网下载 Python、AstrBot 依赖和 QQ 协议组件。

## 下载与使用

[下载 Windows 程序](https://github.com/ningmenggeng-svg/qqbot-workbench/releases/download/v0.1.0/QQBotWorkbench-0.1.0-win-x64.exe) · [发行说明与校验文件](https://github.com/ningmenggeng-svg/qqbot-workbench/releases/tag/v0.1.0)

下载 `QQBotWorkbench-0.1.0-win-x64.exe` 后双击打开。无需自己安装 Node.js 或 Python。

1. 准备一个单独的 QQ 小号，并把它加入目标群。在专用 Windows 用户、虚拟机或专用电脑运行机器人。
2. 在工作台输入机器人 QQ 号，使用密码或扫码登录。QQ 密码只用于当次登录，不保存到工作台配置。
3. 点击「登录 ChatGPT」，在 OpenAI 官方页面完成授权。程序会自动选择并测试一个账号可用的 GPT 模型。
4. 填写目标 QQ 群号，点击「启用群聊」。连接就绪后，在目标群里 `@机器人 你好`。

关闭窗口后程序留在系统托盘；右键托盘选择「退出并停止机器人」才会停止本程序的服务。程序不会设置系统开机启动。

若系统缺少 WebView2，工作台会退回到默认浏览器打开。安装包尚未代码签名；请核对 Releases 附带的 SHA256SUMS，勿使用来源不明的改包。

## 给助手一个链接来安装

把本仓库链接和下面这段话一起发给能操作本机的编程助手：

> 请先阅读这个项目的 README 和 INSTALL.md，帮我下载最新 Windows 安装程序并打开。我会本人完成 QQ 小号和 ChatGPT 登录，然后输入群号。不要操作我的 QQ 主号，也不要读取或上传其他账号的配置。

安装助手应按 [INSTALL.md](INSTALL.md) 工作。单纯打开链接不会自动获得执行安装或读取账号的授权。

## 学习这个项目

这个项目有两条在本机执行的流程：

- **部署流程**：解包运行时 → 安装依赖 → 本人登录 QQ 小号 → 本人授权 ChatGPT → 配置目标群 → 启用消息连接。
- **对话流程**：QQ 群 @机器人 → NapCat 接收消息 → AstrBot 整理上下文 → CPA 转发模型请求 → 模型生成回答 → 原路回复到群。

NapCat 负责接收和发送 QQ 消息，AstrBot 负责对话、模型配置及群限制，CPA 将账号授权连接到模型接口，桌面工作台负责安装和配置这些组件。

GitHub Actions 的 Workflow 是另一类流程：代码更新后自动检查、打包和发布程序。当前仓库未配置 Actions 工作流；发行包在 Windows 本机通过 `scripts/build.ps1` 构建，一键部署不依赖 GitHub Actions。

## 主号保护与验证边界

- 程序只接受用户明确填写的机器人 QQ 号，不选择历史登录账号，不接管已存在的 NapCat 面板，不退出或重启系统 QQ。
- 当前 Windows 会话存在 `QQ.exe` 时，程序拒绝启动自己的 QQ 组件。
- **独立程序文件夹不等于 QQ 数据完全隔离。** NapCat 使用的腾讯原生组件可能共用同一 Windows 用户下的 QQ 数据根。要隔离主号数据，请使用专用 Windows 用户、虚拟机或专用电脑。
- 登录后会核验真实账号与填写的机器人号一致，核验通过、模型测试成功并明确启用群聊后才配置消息连接。
- QQ 密码登录可能需要腾讯验证码或新设备验证，可改用扫码或在组件面板由本人完成验证。
- 发行前会验证安装包解压、本机控制服务、空白配置、密码处理和账号核验。QQ 的真实登录与群消息收发仍需使用独立机器人账号进行现场验证，不能保证任意账号或腾讯风控状态都能登录。

## ChatGPT 额度

CPA 使用 Codex OAuth 登录路径调用账号可用的模型。使用量受该 ChatGPT 账号可用的 Codex/Work 套餐额度与模型权限限制，不能把网页聊天次数或 OpenAI API 余额当作同一额度，也不承诺无限使用或网页中所有模型可用。

[OpenAI 登录方式说明](https://learn.chatgpt.com/docs/auth) · [套餐与额度说明](https://learn.chatgpt.com/docs/pricing)

## 数据与网络

应用文件、随机生成的本机密钥、OAuth 登录凭据、机器人配置和运行记录保存在 `%LOCALAPPDATA%\QQBotWorkbench`。复制发行版 `.exe` 不会复制这些数据。不要分享这个数据目录，也不要把它提交到 GitHub。

所有控制端口仅监听 `127.0.0.1`；首次使用会为冲突的端口选择空闲端口。模型流量由本机 CPA 连接上游服务，QQ 流量由本机 NapCat 连接腾讯。工作台本身没有云端账号服务器，也没有上传运行记录的接口。

首次准备需要访问 GitHub、PyPI 和 Python 运行时发布源；ChatGPT 授权与模型请求需要对应网络可达。可在高级配置中填写本机代理的实际地址。

## 开发与构建

前端是原生 HTML/CSS/JS，控制服务使用 Node.js 内置模块，桌面窗口使用 .NET Framework 与 Microsoft WebView2。

```powershell
node --test tests/*.test.mjs
powershell -NoProfile -File scripts/build.ps1
```

构建脚本下载、校验并打包公开运行时，输出独立 `.exe` 和校验文件到 `dist/`。需要 Windows x64、.NET Framework C# 编译器与网络。

开发时可设置 `QQBOT_DATA_DIR`、`QQBOT_RUNTIME_DIR`、`QQBOT_PORT`。测试使用 `QQBOT_SKIP_BOOTSTRAP=1` 禁止下载和启动第三方服务。桌面程序支持 `--data-dir <独立测试目录> --smoke-test`，只测试解包和本机控制服务，不启动 QQ。

## 项目来源与许可

本项目是独立社区工具，与 OpenAI、腾讯、NapCat、AstrBot 无官方隶属关系。项目自身代码采用 MIT；依赖组件的许可证及服务条款分别适用，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。NapCat 官方原包仅在用户准备机器人时下载，公开仓库和桌面安装包不内置修改后的 NapCat。
