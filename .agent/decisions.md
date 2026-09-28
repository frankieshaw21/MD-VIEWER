# 技术决策

以下记录可由现有实现或项目文档确认的选择；未记录在代码和文档中的原始讨论理由标记「待确认」。

## 复用一套正式前端

`desktop/MDViewer.Desktop.csproj` 将根目录页面、样式、脚本与 Mermaid 资源复制到 `app/`，桌面 WebView2 和浏览器使用相同前端。这样正式 UI 的主要逻辑保持一致；不选择将 `demo/ui-concept.html` 直接作为桌面入口，因为它是模拟交互，不能读写真实文件。

## 桌面使用 WebView2 虚拟主机与原生文件桥

`desktop/MainForm.cs` 映射 `mdviewer.local` 到打包资源，用 WebMessage 实现原生文件交互，并对文件路径设访问限制。桌面版不启动 localhost PowerShell 服务；便携网页版仍由 `md-viewer-server.ps1` 提供目录浏览等能力。桌面文件权限检查不能仅依赖网页侧代码。

## 浏览器本地持久化与离线资源

`js/history.js` 使用 IndexedDB 保存历史快照，`js/files.js` 保存会话及浏览器文件句柄，主题等使用 localStorage；`mermaid.min.js` 随仓库分发。选择运行时不依赖云服务，避免仅为查看本地文档而要求在线连接。桌面“检查更新”是可选网络请求，不应阻碍离线启动。

## 单实例与发布方式

`desktop/Program.cs` 通过互斥体和命名管道复用已有窗口；再次打开文件时无需再开一套 WebView2。`desktop/build.ps1` 生成自包含的 Windows x64 桌面程序，`.github/workflows/release.yml` 将其通过 Inno Setup 打包并发布 SHA-256 校验文件。GitHub Actions 里的项目安装包签名当前未配置；证书采购及签名方案「待确认」。

## 性能折中

编辑延迟渲染、minimap 动画帧合并以及降低文件监控轮询频率用于减少大文档与后台运行成本；外部变更的定时发现可能有延迟，焦点恢复时会检查。确切收益需在相同测试条件下测量，不能由设计意图直接推断。
