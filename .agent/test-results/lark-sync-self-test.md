# 飞书同步自测

## 范围与环境

针对当前未提交的飞书手动同步改动，使用本机 Windows、.NET 8.0.423、Node 24.18.0、Edge 和 WebView2。测试对象是重新构建的 `desktop/publish/MDViewer.exe` 与正式 `md-viewer.html`，不是 Demo 或旧安装版。

未提供可用于覆盖测试的飞书文档，因此所有远端操作使用临时 PowerShell mock CLI；没有调用真实飞书文档，也没有测试真实账号授权。桌面测试使用独立 WebView2 数据目录和临时 Markdown，结束时关闭测试进程、删除临时文件与本次同步基线，并恢复原有 trusted-files.json。启动前要求关闭已有 MD Viewer，防止单实例转发进入用户会话。

## 通过的检查

- 所有 `js/*.js` 和新增 Node 测试脚本语法检查；`git diff --check`。
- `desktop/build.ps1` 发布构建与前端资源校验成功；仍有既有 MSB3277 WindowsBase 引用冲突警告。
- C# 真实服务 + mock CLI：首次上传、首次下载备份、已有映射下载、revision 冲突、本地哈希冲突、双方修改拒绝、Unicode 路径、失败不推进基线、更新响应失败、revision 写入竞争失败、single-flight 并发拒绝、获取远端期间本地文件变化拒绝、人工将两端内容调整一致后恢复基线、合法空 Markdown 下载。
- 最新桌面 WebView2 中点击真实同步按钮，经 WebMessage 和原生服务调用 mock CLI：上传内容正确、远端 revision 冲突拒绝、下载备份内容正确且编辑器重载成功、未保存编辑拦截、非法飞书 URL 拒绝、取消不写入、不生成备份、CLI 非零退出和非 JSON 响应保留本地并恢复按钮、未授权路径被原生宿主拒绝。
- 下载期间继续在源码编辑器输入，在取消重载后编辑仍保留；磁盘收到远端内容。后续手动重载、源码输入、实际磁盘保存通过。
- 独立 headless Edge 离线加载正式页面：浏览器模式同步入口隐藏，源码编辑与预览往返通过。

桌面测试为可重放的 CDP 自动化：当前版本使用真实同步窗口输入链接并点击上传/下载按钮，仅替换阻塞性的 JS confirm/alert；真实前端点击处理、WebView2、原生路径授权和进程调用均未替换。原生确认框外观、键盘与鼠标操作未人工验收。

### 发布后错误提示与授权教程回归（本地未发布）

- 针对用户截图中找不到 `lark-cli` 时泄漏 CLIXML 的问题，增加 PowerShell 命令存在性检查与 Text 输出；原始 stdout/stderr 不拼入面向用户的错误，改为简短原因分类。
- 服务测试运行真正不存在的命令路径，得到“未找到 lark-cli”；同时验证 CLIXML 不回显，以及登录过期、缺少 scope、连接失败等分类。
- 最新桌面同步窗口验证上传、下载、备份、冲突、未保存拦截、取消、非法链接、原生路径授权、下载期间编辑保留、源码保存；CLI 模拟缺失/过期/权限/无效 JSON 均保留本地并恢复按钮，缺失/授权错误自动展开教程。离线 Edge 回归通过。
- 内置教程依据本机已安装的 `@larksuite/cli/README.zh.md`，包括 Node.js 前置条件、官方 `npx` 安装、`config init`、`auth login --recommend`、`auth status`；仅核对命令文档，未执行新安装或账号授权。
- `MDVIEWER_PREVIEW_DIR` 指定截图目录后运行桌面脚本，会捕获最新实际 WebView2 对话框的 `failure.png` 与 `authorization.png`；当前预览保存在 `C:/tmp/mdviewer-lark-preview/`。图片中的文档/链接为测试数据，不是实际用户文档。

## 发现与修复

补测发现：服务将远端 JSON 中的 `content: null` 当作空 Markdown，下载时可能清空本地文件。已改为只接受字符串内容，null 等无效类型抛错，不写本地、不推进基线；合法空字符串仍允许下载。新增对应回归测试，通过后重建桌面并重新执行完整桌面同步测试。

测试脚本调试中修正了文件切换 API 名、Windows 短路径比较、未保存编辑模拟方式和字符串转义错误；这些是测试脚本问题，不是应用回归。

## 重放命令

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File ./desktop/build.ps1
dotnet run --project tests/lark-sync/LarkSync.Tests.csproj
node tests/lark-sync-desktop.mjs
node tests/lark-sync-browser.mjs
git diff --check
```

需要 Windows PowerShell、.NET 8 SDK、Node 22+、Edge/WebView2；桌面测试启动前关闭 MD Viewer，浏览器脚本可通过 `MDVIEWER_TEST_EDGE` 指定 Edge 路径。测试使用本地端口 19338/19339，执行时需空闲。

## 未覆盖与限制

- 真实 `lark-cli` 用户授权、真实 Wiki / Docx 权限、飞书真实响应结构和写入兼容性尚未验证。当前通过的是 mock CLI 的端到端链路，不等同于真实飞书同步验收。
- 两分钟超时、网络断开、进程突然崩溃、磁盘满/备份目录不可写等场景未执行。
- 未做完整安装/升级、真实 IME、全量历史和所有多标签回归；未覆盖自动同步/合并窗口，因为当前未实现。
- 下载和其他原生写入之间仍可能存在极短的检查后写入竞争窗口；当前 hash 检查不是跨进程原子锁，不能宣称覆盖所有文件并发场景。
