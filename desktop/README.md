# MD Viewer 桌面版

这是基于 WebView2 的 Windows 桌面外壳，复用根目录中的 Viewer 前端。

## 构建

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\build.ps1
```

输出：`desktop\publish\MDViewer.exe`。发布为 win-x64 自包含应用，目标电脑只需安装 Microsoft Edge WebView2 Runtime。

## 安装

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\install.ps1
```

安装到 `%LOCALAPPDATA%\Programs\MD Viewer`，创建开始菜单快捷方式，并注册 `.md` / `.markdown` 的“打开方式”。在软件工具栏点击“设为默认”，再在 Windows 设置中确认默认应用。

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
