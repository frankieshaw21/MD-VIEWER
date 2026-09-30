# 当前工作状态

## 分支与版本

- 当前工作分支：`feature/md-viewer-performance`；开始新任务时运行 `git status -sb` 再确认，分支可能变化。
- 当前 `VERSION`：`0.1.6`；`v0.1.5` 已推送至 origin。正式应用已经包含紧凑工具栏、插入/更多菜单、保存状态及预览/源码/分屏入口；独立 UI Demo 仍在 `demo/`。

## 当前任务

`.agent/` 已作为长期项目上下文建立；`CONTRIBUTING.md` 的发布前检查清单要求核对 `.agent/current-work.md`，并按需更新相关文档。后续开始任务时应先确认 `git status -sb` 和远端状态；未经要求不自动创建版本标签或发布。

## 已有验证与待确认

- 此前运行过 `desktop/build.ps1`，发布构建成功；对本地 `desktop/publish/MDViewer.exe` 做过 WebView2 启动、临时 Markdown 打开、模式切换、编辑保存与单实例转发验证。这是先前版本的验证记录，不等同于此后每次修改都已验证。
- 本机曾出现 WebView2 相关 `WindowsBase` 引用冲突警告，未见于上述验证中的运行失败；是否影响其他干净 Windows 环境「待确认」。复合 ReadyToRun 编译曾使本机 crossgen2 访问冲突，非复合 ReadyToRun 发布成功；项目已明确禁用复合模式。
- 更新检查改用 GitHub `/releases/latest` 的网页跳转，避免匿名 API 限流；本机用旧版本号 0.1.4 调用新检查器已取得 v0.1.5，旧安装版仍需手工更新才能获得此修复。桌面版“更多 → 检查软件更新”提供进度和结果反馈；状态栏“↻ 更新”用于重新加载当前文档，新增进行中、成功、取消及失败反馈，不是软件版本更新。
- 安装向导在干净 Windows 环境的完整测试「待确认」。项目安装包当前没有配置代码签名，SmartScreen 信誉提示仍可能出现；证书及签名方案「待确认」。
- `.agent/` 文档完成后检查链接、中文内容和 `git diff --check`；如未改应用代码，无需仅为文档重复运行桌面构建。
