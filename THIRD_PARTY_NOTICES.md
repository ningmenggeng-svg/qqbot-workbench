# Third-party components

QQBot Workbench is an independent community project. It is not an official product of OpenAI, Tencent, NapCat, or AstrBot.

The Windows application embeds unmodified Node.js 24.19.0, uv 0.13.5, CLIProxyAPI 8.0.38, and Microsoft WebView2 SDK redistributable assemblies. Their original license notices are installed in `app/licenses/`.

- Node.js: https://github.com/nodejs/node — MIT and bundled third-party notices.
- uv: https://github.com/astral-sh/uv — MIT OR Apache-2.0.
- CLIProxyAPI: https://github.com/router-for-me/CLIProxyAPI — MIT.
- Microsoft WebView2: https://www.nuget.org/packages/Microsoft.Web.WebView2 — Microsoft Software License Terms included with its NuGet package. The installed Microsoft WebView2 Runtime has its own terms.
- AstrBot 4.29.1 and Python dependencies are downloaded at first run. AstrBot: https://github.com/AstrBotDevs/AstrBot — AGPL-3.0. The installed package retains its source and license metadata; this repository does not redistribute an altered AstrBot build.
- NapCat 4.18.41 is downloaded unchanged from https://github.com/NapNeko/NapCatQQ/releases/tag/v4.18.41 only after the user chooses to prepare their independent robot account. It is not embedded in the application or included in this repository. NapCat uses the Limited Redistribution License: https://github.com/NapNeko/NapCatQQ/blob/main/LICENSE. Its noncommercial and redistribution conditions apply separately.

The MIT license on this project's own controller and UI does not change the licenses, service terms, account requirements, or usage limits of any component or upstream service.
