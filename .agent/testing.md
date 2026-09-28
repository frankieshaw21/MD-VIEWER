# 测试与验证

## 静态检查

在仓库根目录运行：

```powershell
Get-ChildItem .\js\*.js | ForEach-Object { node --check $_.FullName }
git diff --check
```

`node --check` 仅检查语法，不验证浏览器行为。仓库当前未见统一的自动化单元测试命令；新增测试或脚本前先确认环境依赖。

## 桌面构建与安装

在 Windows 和 .NET 8 SDK 环境运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\build.ps1
```

脚本执行 `dotnet publish`，检查 `desktop/publish/MDViewer.exe`、前端资源及 Mermaid 文件哈希；发布内容还应包含新加入的模块。`desktop/install.ps1` 是安装到本机的操作，只有明确需要安装验证时执行；不要用构建通过代替安装验证。当前本地构建中曾出现 WebView2 NuGet 包相关的 `WindowsBase` 4.0.0.0 / 5.0.0.0 冲突警告，但构建通过；其他环境的结果待确认。

## 手工功能回归

使用临时 Markdown 文件而非真实用户文档，至少检查：打开与再次启动转发文件、多标签、预览/源码/分屏切换、编辑和覆盖保存、重新加载、未保存提示、查找替换、插入菜单、主题以及外部修改冲突。需要验证 UI 变化时分别检查浏览器页面与桌面 WebView2；桌面版读取的是 `desktop/publish/app/` 中的前端副本，修改源码后必须重新构建。

## 性能采样与发布

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\performance-smoke.ps1 -DocumentPath C:\path\to\sample.md
```

该脚本要求桌面程序已经安装，生成的 `desktop/performance-results.json` 仅供本地分析，不应提交。发布流程位于 `.github/workflows/release.yml`：更新 `VERSION`、`CHANGELOG.md` 后推送 `vX.Y.Z` 标签触发构建；需要到 GitHub Actions 与 Releases 确认实际结果。现有流程未配置项目自身安装包的代码签名；SmartScreen 信誉问题不能靠校验哈希或自签名消除。
