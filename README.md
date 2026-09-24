# MD Viewer

当前版本：`0.1.2`（版本历史见 [CHANGELOG.md](CHANGELOG.md)）。

一个面向 Windows 的本地 Markdown 阅读与编辑工具。无需安装依赖或构建，支持离线运行，并针对大文档、表格编辑和飞书复制粘贴做了优化。

## 主要功能

- 预览、Markdown 源码及源码/预览分屏编辑，支持 H1–H6 大纲和精确跳转
- 多文件打开、外部修改检测、重载、保存及未保存冲突提示
- IndexedDB 本地历史记录，每个文件最多保留 30 个版本
- 表格合并、拆分、增删行列、整表删除和单元格背景色
- 飞书兼容的富文本、表格、文字颜色及单元格颜色复制粘贴
- 标题、列表、待办、引用、代码块、链接、图片和 Mermaid 图表（支持缩放、全屏及导出）
- 文档内查找与替换、区分大小写和匹配项跳转
- 浅色、护眼、深色主题，以及标准、宽版、全宽内容布局
- 自适应延迟渲染、增量 DOM 增强和 minimap 节流，适合大型文档

## 快速开始

### Windows 桌面版（推荐）

桌面版支持双击 `.md` 打开、原位保存、单实例多标签和默认应用注册：

```powershell
powershell -ExecutionPolicy Bypass -File .\desktop\install.ps1
```

普通用户从 GitHub [Releases](https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases) 下载 `MDViewer-Setup-版本号-win-x64.exe`，双击并按安装向导操作即可。安装程序包含 WebView2 离线运行组件，安装时无需联网或预装 .NET SDK。详见 [`desktop/README.md`](desktop/README.md#普通用户一键安装)。推送 `v*` 版本标签会自动构建并上传软件包及 SHA-256 校验文件。桌面版不启动 localhost 服务。

### 便携网页版：双击启动

```text
MD-Viewer.vbs
```

启动器会静默运行本地服务，并优先使用 Microsoft Edge 应用模式打开 Viewer。默认地址为 `http://localhost:8899/md-viewer.html`。

### PowerShell 启动

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\md-viewer-server.ps1
```

然后访问 `http://localhost:8899/`；在终端按 `Ctrl+C` 可停止服务。

### 直接离线打开

也可以直接双击 `md-viewer.html`，通过 `file:///` 使用。浏览器未授予文件写入权限时，保存会回退为下载同名 Markdown 文件；如需目录浏览和更稳定的外部变化检测，推荐使用 VBS 或 PowerShell 启动方式。

## 界面导览

实际界面以 [`md-viewer.html`](md-viewer.html) 为准：顶部工具栏提供打开、保存、全部保存、历史记录及格式/插入操作；右侧可切换“源码”“分屏”、内容宽度和主题。左侧侧栏可在“文件”和“大纲”之间切换，底部状态栏提供当前文件重新加载入口。选中表格单元格后右键可打开行列、合并拆分及背景色菜单；点击 Mermaid 图表可使用缩放、全屏与导出工具。

[`demo/ui-concept.html`](demo/ui-concept.html) 是可单独打开的**界面方案演示**，用于评估工具栏与交互；它不读取或保存真实文件，也不是当前正式界面。不要在 Demo 中编辑重要内容。

## 常用操作

| 操作 | 快捷键或方式 |
| --- | --- |
| 打开文件 | `Ctrl+O` 或拖放文件 |
| 保存 / 全部保存 | `Ctrl+S` / `Ctrl+Shift+S` |
| 查找 / 替换 | `Ctrl+F` / `Ctrl+H` |
| 下一个 / 上一个匹配项 | `Ctrl+G` / `Ctrl+Shift+G` |
| 重新读取 Markdown | `Ctrl+R` |
| 切换源码/预览 | `Ctrl+/`；工具栏“分屏”可同时显示两者 |
| 粗体 / 斜体 | `Ctrl+B` / `Ctrl+I` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` 或 `Ctrl+Shift+Z` |
| 表格编辑 | 在单元格上单击右键 |
| 复制到飞书 | 选择内容后使用标准 `Ctrl+C` |

页面内的“重新加载”只重新读取当前 Markdown。Viewer 源码更新后，请关闭旧页面重新打开，或使用 `Ctrl+F5` 强制刷新。

## 社区与项目治理

- 反馈问题或提出建议：使用仓库的 [Issues](https://github.com/bwj6wjrtsk-hash/MD-VIEWER/issues) 模板。
- 提交改动：阅读 [参与贡献](CONTRIBUTING.md)，并使用 PR 模板说明验证情况。
- 报告安全漏洞：阅读 [安全政策](SECURITY.md)，不要公开披露漏洞详情。

## 数据与隐私

所有处理均在本机完成，不包含云端协作或数据上传功能。历史记录保存在浏览器 IndexedDB 中，会话和界面设置保存在 localStorage 中；清理浏览器站点数据会同时删除这些本地数据。

## 项目结构

```text
MD-Viewer/
├─ md-viewer.html          # 页面结构与脚本入口
├─ MD-Viewer.vbs           # Windows 静默启动器
├─ md-viewer-server.ps1    # localhost 文件服务与目录浏览 API
├─ mermaid.min.js          # 本地 Mermaid 引擎
├─ assets/md-viewer.css    # 页面样式
└─ js/
   ├─ context.js           # 状态、事件总线和模块端口
   ├─ parser.js            # Markdown/HTML 双向转换
   ├─ history.js           # IndexedDB 历史记录
   ├─ editor.js            # 编辑器、渲染、大纲和命令
   ├─ source-tools.js      # 源码编辑辅助工具
   ├─ search.js            # 查找与替换
   ├─ mermaid-tools.js     # Mermaid 图表交互与导出
   ├─ desktop.js           # 桌面宿主桥接
   ├─ files.js             # 文件、会话、刷新和冲突处理
   ├─ tables.js            # 表格结构与颜色编辑
   ├─ clipboard.js         # 飞书兼容复制粘贴
   ├─ ui.js                # 主题、侧栏、minimap 和快捷键
   └─ bootstrap.js         # 模块组合与应用启动

desktop/                   # Windows WebView2 桌面宿主、构建与安装脚本
demo/ui-concept.html       # 独立界面方案演示（非正式应用）
```

模块通过 Context、ports 和事件总线通信，入口加载顺序定义在 `md-viewer.html` 中。

## 开发说明

项目运行时不需要 Node.js、npm 或网络连接。修改 HTML、CSS 或 JavaScript 后重新打开页面即可；若本机安装了 Node.js，可用以下命令进行基础语法检查：

```powershell
Get-ChildItem .\js\*.js | ForEach-Object { node --check $_.FullName }
```

建议使用最新版 Microsoft Edge 或其他 Chromium 浏览器。文件系统写入能力取决于浏览器的 File System Access API 和用户授权。桌面版构建、安装及卸载说明见 [`desktop/README.md`](desktop/README.md)。