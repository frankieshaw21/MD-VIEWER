# MD Viewer

一个面向 Windows 的本地 Markdown 阅读与编辑工具。无需安装依赖或构建，支持离线运行，并针对大文档、表格编辑和飞书复制粘贴做了优化。

## 主要功能

- 预览与 Markdown 源码双模式编辑，支持 H1–H6 大纲和精确跳转
- 多文件打开、外部修改检测、重载、保存及未保存冲突提示
- IndexedDB 本地历史记录，每个文件最多保留 30 个版本
- 表格合并、拆分、增删行列、整表删除和单元格背景色
- 飞书兼容的富文本、表格、文字颜色及单元格颜色复制粘贴
- 标题、列表、待办、引用、代码块、链接、图片和 Mermaid 图表
- 浅色、护眼、深色主题，以及标准、宽版、全宽内容布局
- 自适应延迟渲染、增量 DOM 增强和 minimap 节流，适合大型文档

## 快速开始

### 推荐：双击启动

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

## 常用操作

| 操作 | 快捷键或方式 |
| --- | --- |
| 打开文件 | `Ctrl+O` 或拖放文件 |
| 保存 | `Ctrl+S` |
| 重新读取 Markdown | `Ctrl+R` |
| 切换源码/预览 | `Ctrl+/` |
| 粗体 / 斜体 | `Ctrl+B` / `Ctrl+I` |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` 或 `Ctrl+Shift+Z` |
| 表格编辑 | 在单元格上单击右键 |
| 复制到飞书 | 选择内容后使用标准 `Ctrl+C` |

页面内的“重新加载”只重新读取当前 Markdown。Viewer 源码更新后，请关闭旧页面重新打开，或使用 `Ctrl+F5` 强制刷新。

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
   ├─ files.js             # 文件、会话、刷新和冲突处理
   ├─ tables.js            # 表格结构与颜色编辑
   ├─ clipboard.js         # 飞书兼容复制粘贴
   ├─ ui.js                # 主题、侧栏、minimap 和快捷键
   └─ bootstrap.js         # 模块组合与应用启动
```

模块通过 Context、ports 和事件总线通信，入口加载顺序定义在 `md-viewer.html` 中。

## 开发说明

项目运行时不需要 Node.js、npm 或网络连接。修改 HTML、CSS 或 JavaScript 后重新打开页面即可；若本机安装了 Node.js，可用以下命令进行基础语法检查：

```powershell
Get-ChildItem .\js\*.js | ForEach-Object { node --check $_.FullName }
```

建议使用最新版 Microsoft Edge 或其他 Chromium 浏览器。文件系统写入能力取决于浏览器的 File System Access API 和用户授权。