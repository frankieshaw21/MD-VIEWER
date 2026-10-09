# MD Viewer 桌面版

这是基于 WebView2 的 Windows 桌面外壳，复用根目录中的 Viewer 前端。主界面操作与网页版一致：顶部工具栏可打开、保存、查找、切换源码/预览与分屏，侧栏可查看文件及大纲，在“文件”页点击“选择文件”即可选择 Markdown 并直接阅读，点击下方已打开文件列表可切换文档。完整界面说明和快捷键见 [根目录 README](../README.md#界面导览)。仓库中的 [`demo/ui-concept.html`](../demo/ui-concept.html) 仅为独立交互演示；桌面版已采用其中的紧凑工具栏设计，并保留完整编辑功能。

## 普通用户：一键安装

1. 打开 [GitHub Releases](https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases)，下载 `MDViewer-Setup-版本号-win-x64.exe`。
2. 双击安装程序，按向导完成安装。安装包内含 .NET 应用和 WebView2 Runtime 离线安装程序；无需解压、运行命令或联网下载依赖。首次安装可能出现 Windows 管理员权限确认。
3. 安装完成后从开始菜单启动 MD Viewer。需要双击 `.md` 文件打开时，在应用工具栏点击“默认”，并按 Windows 提示确认默认应用。

桌面版启动时会检查 GitHub 最新正式版，也可通过“更多 → 检查软件更新”手动检查并查看检查结果；发现新版本后可确认后台下载，下载期间仍可编辑文档。确认下载时即授权安装，校验完成后自动启动安装程序并关闭应用；若安装被阻止，可点击“安装版本号”重试；安装前必须先保存或放弃未保存文档，Windows 仍可能显示管理员授权提示。底部的“↻ 更新”用于重新加载当前文件，并非检查应用版本。网络不可用不会阻止启动；未经下载确认不会自动安装，也不会覆盖未保存的文档。请先保存并退出再运行安装包。

同一 Release 提供 `.sha256` 校验文件。可通过 PowerShell `Get-FileHash .\MDViewer-Setup-版本号-win-x64.exe -Algorithm SHA256` 核对下载文件。

## 飞书文档同步（手动）

参考 [lark-md-sync-desktop](https://github.com/frankieshaw21/lark-md-sync-desktop)，通过已安装且完成用户授权的 `lark-cli` 操作飞书，不在 MD Viewer 中保存授权凭据。此可选功能需要联网及 Windows PowerShell；普通离线编辑不受影响。可用 `LARK_MD_SYNC_CLI` 指定 CLI 路径。

1. 打开本地 Markdown 并保存所有改动。
2. 点击“更多 → 同步飞书文档”，在同步窗口填写有权限的 Wiki / Docx 链接。
3. 点击“上传到飞书”或“下载到本地”，并确认覆盖方向。首次上传覆盖远端；下载在文件旁保留唯一命名的 `.lark-backup-*.md` 备份。失败只显示简短原因，不展示 PowerShell XML/原始日志；缺少 CLI、授权或权限时自动展开教程。

### 首次安装与飞书授权

同步窗口内置相同教程。先从 [Node.js 官网](https://nodejs.org/zh-cn/download) 安装 LTS（含 npm），再在 Windows 终端 / PowerShell 中依次操作：

```powershell
# 安装 CLI；使用 npx.cmd 避免 PowerShell 对 npx.ps1 的执行策略限制
npx.cmd @larksuite/cli@latest install
# 配置应用：按引导在浏览器创建/选择应用，或使用企业提供的凭证
lark-cli config init
# 使用有文档权限的账号登录，并在浏览器确认授权
lark-cli auth login --recommend
# 检查登录状态和授权范围
lark-cli auth status
```

安装后重启 MD Viewer 以读取新 PATH；如命令仍无法识别，重新打开终端确认 CLI 已安装并在 PATH 中。下载需要云文档读取权限，上传需要编辑权限，Wiki 还需对应知识库访问权限。推荐授权不替代企业权限审批；应用权限受限制时请联系管理员，并按 CLI 引导授予所需权限后重新登录。不要把应用密钥或登录凭据发给他人，MD Viewer 不保存这些凭据。完整 CLI 配置说明见 [官方指南](https://github.com/larksuite/cli)。

后续上传使用 revision 并发保护，下载检查本地内容哈希；目标发生变化时拒绝覆盖，基线不推进。冲突需手动核对两端，将两端内容调整一致后再同步；当前不提供冲突合并窗口、自动轮询或多任务管理。下载期间若继续编辑，重载由现有未保存/外部变化流程处理，请先核对再选择，勿放弃新改动。Markdown 无法无损保留飞书专属 Block、样式和评论。

链接按本地文件记录在 WebView 本地存储中；同步基线在 `%APPDATA%\MDViewer\lark-sync\`，不复用参考工具的任务配置。

## 开发者：从源码构建安装

需要安装 .NET 8 SDK 后，在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build.ps1
powershell -ExecutionPolicy Bypass -File .\desktop\install.ps1
```

构建输出为 `desktop\publish\`。安装脚本优先使用已有发布文件；若没有发布文件，才调用构建脚本。

## 卸载

关闭 MD Viewer 后执行：

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\uninstall.ps1
```

## 桌面能力

- 原生打开与覆盖保存，不再依赖 localhost PowerShell 服务
- 双击 Markdown 文件启动，后续文件复用同一窗口
- 仅允许读写由启动参数、原生文件选择器或已授权历史记录提供的路径
- 监控当前文件的外部变化
- 关闭窗口时提示未保存内容
- 启动时检查正式版更新；发现新版本后由用户确认下载，校验成功后自动启动安装。底部“↻ 更新”仅重新加载当前文件
