# MD Viewer 桌面版

这是基于 WebView2 的 Windows 桌面外壳，复用根目录中的 Viewer 前端。主界面操作与网页版一致：顶部工具栏可打开、保存、查找、切换源码/预览与分屏，侧栏可查看文件及大纲。完整界面说明和快捷键见 [根目录 README](../README.md#界面导览)。仓库中的 [`demo/ui-concept.html`](../demo/ui-concept.html) 仅为独立界面方案演示，不是桌面版界面。

## 普通用户：一键安装

1. 打开 [GitHub Releases](https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases)，下载 `MDViewer-Setup-版本号-win-x64.exe`。
2. 双击安装程序，按向导完成安装。安装包内含 .NET 应用和 WebView2 Runtime 离线安装程序；无需解压、运行命令或联网下载依赖。首次安装可能出现 Windows 管理员权限确认。
3. 安装完成后从开始菜单启动 MD Viewer。需要双击 `.md` 文件打开时，在应用工具栏点击“默认”，并按 Windows 提示确认默认应用。

桌面版启动时会检查 GitHub 最新正式版；发现新版本时可以选择前往发布页面查看说明、下载并运行安装包，也可以选择“否”继续使用当前版本。帮助 → 检查更新可随时手动检查。网络不可用不会阻止启动；更新不会自动安装或覆盖未保存的文档。请先保存并退出再运行安装包。

同一 Release 提供 `.sha256` 校验文件。可通过 PowerShell `Get-FileHash .\MDViewer-Setup-版本号-win-x64.exe -Algorithm SHA256` 核对下载文件。

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
- 启动时检查正式版更新，也可通过菜单“帮助 → 检查更新”手动检查；更新需要用户自行下载安装
