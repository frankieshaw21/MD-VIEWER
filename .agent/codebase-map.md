# 代码地图

| 路径 | 职责 |
| --- | --- |
| `md-viewer.html` | 正式界面、工具栏、状态栏、DOM 容器及脚本加载顺序。 |
| `assets/md-viewer.css` | 布局、主题、编辑区、响应式与打印样式。 |
| `js/context.js` / `js/bootstrap.js` | 上下文、状态、事件、端口注册与全局命令桥接。 |
| `js/parser.js` / `js/editor.js` | Markdown/HTML 转换；文档编辑、渲染、源码/预览/分屏、大纲。 |
| `js/files.js` / `js/history.js` | 文件记录、读写与冲突、会话；IndexedDB 历史快照。 |
| `js/tables.js` / `js/clipboard.js` | 表格结构与颜色；富文本和飞书兼容复制粘贴。 |
| `js/search.js` / `js/source-tools.js` / `js/mermaid-tools.js` | 查找替换、源码辅助、图表交互及导出。 |
| `js/ui.js` / `js/desktop.js` | 主题、布局、侧栏、快捷键；桌面 WebMessage 桥接。 |
| `mermaid.min.js` | 本地打包的 Mermaid 引擎。 |
| `MD-Viewer.vbs` / `md-viewer-server.ps1` | Windows 便携启动；localhost 页面与目录/文件 API。 |
| `desktop/Program.cs` / `desktop/MainForm.cs` | 单实例、文件参数转发；WebView2 窗口及受控原生文件服务。 |
| `desktop/FileAssociations.cs` / `desktop/UpdateChecker.cs` | Windows 文件关联；检查 GitHub 正式版更新。 |
| `desktop/MDViewer.Desktop.csproj` / `desktop/build.ps1` | .NET 8 项目配置；发布和必需文件验证。 |
| `desktop/install.ps1` / `desktop/uninstall.ps1` / `desktop/installer.iss` | 本地安装、卸载及 Inno Setup 安装包定义。 |
| `desktop/performance-smoke.ps1` | 已安装桌面程序的资源采样脚本。 |
| `.github/workflows/release.yml` | `v*` 标签触发的 Windows 安装包与 SHA-256 发布流程。 |
| `demo/ui-concept.html` / `demo/ui-concept.png` | 独立静态交互演示与 README 截图，非正式应用。 |
| `VERSION` / `CHANGELOG.md` / `README.md` / `desktop/README.md` | 版本、变更说明、使用和桌面安装文档。 |

忽略构建产物目录 `desktop/bin/`、`desktop/obj/`、`desktop/publish/`；修改源码而不是构建输出。路径和模块依赖请与 `md-viewer.html`、`js/bootstrap.js`、`desktop/MDViewer.Desktop.csproj` 的实际声明核对。
