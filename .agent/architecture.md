# 系统架构

## 运行形态

- 正式前端是 `md-viewer.html`、`assets/md-viewer.css`、`js/*.js` 与本地 `mermaid.min.js`，可在支持的浏览器中离线打开。
- 便携启动器 `MD-Viewer.vbs` 启动 `md-viewer-server.ps1`；该服务在 `localhost:8899` 提供页面及文件读取、目录浏览等 API。直接打开 `file:///` 时文件能力受浏览器授权限制。
- 桌面版是 `desktop/` 的 WinForms + WebView2 程序。`MainForm.cs` 将打包的 `app/` 内容映射到 `https://mdviewer.local/`，通过 WebMessage 与 `js/desktop.js` 通信；它不使用上述 localhost 服务。`Program.cs` 使用互斥体和命名管道实现单实例，并把后续启动传入的文件路径转发至主窗口。

## 前端模块关系

`md-viewer.html` 按顺序加载脚本，`js/bootstrap.js` 创建 `js/context.js` 提供的 `context`，注册各模块端口并启动。`context.state` 存放界面与编辑状态；`context.getPort()` 用于模块调用；`context.on()` / `context.emit()` 用于状态和文件事件。工具栏的全局调用由 `bootstrap.js` 桥接到对应端口。

- `js/parser.js` 负责 Markdown 与 HTML 转换；`js/editor.js` 管理预览、源码、分屏、渲染及大纲。
- `js/files.js` 管理多文件、会话、保存、外部变化和冲突；通过 `editor.getContent({ flush: true })` 取得当前文档内容。
- `js/history.js` 在 IndexedDB 中保存版本快照；`js/tables.js`、`js/clipboard.js`、`js/search.js`、`js/source-tools.js`、`js/mermaid-tools.js` 提供专项编辑功能；`js/ui.js` 负责主题、布局、侧栏、minimap 与快捷键。

## 数据流与持久化

打开文件时，`files` 创建文件记录并交给 `editor` 呈现；预览或源码修改经 `files.updateActiveContent()` 更新当前记录并产生事件，保存时由相应浏览器或桌面读写路径写回文件。历史快照由 `history` 写入 `md-viewer-history` IndexedDB；浏览器文件句柄使用 `md-viewer-handles` IndexedDB；会话和主题等设置存在 localStorage。桌面宿主另维护获准访问的文件路径。切换模式及保存前需注意同步或刷新编辑内容，不应只操作展示 DOM。

## 关键边界

桌面版文件路径由原生打开、启动参数或已授权记录提供；`MainForm.cs` 验证可访问路径后处理 WebMessage。桌面内容版本通过打包 `app/` 文件的哈希计算，并在版本变化时清理磁盘缓存。不能把 `demo/ui-concept.html` 的模拟保存行为当成真实文件写入。
