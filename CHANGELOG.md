# 更新日志

本项目采用 [语义化版本](https://semver.org/lang/zh-CN/)（`主版本.次版本.修订版本`）。发布版本见 [GitHub Releases](https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases)。

## [未发布]

暂无。

## [0.1.5] - 2026-09-29

### 修复
- 修复代码块分隔的有序列表在预览中重新从 1 编号的问题，并保留列表起始序号。
- 全选源码复制时，纯文本剪贴板保留原始 Markdown，而非转换后的预览文字。
- 桌面发布保留 ReadyToRun，关闭导致本机 crossgen2 崩溃的复合编译。

## [0.1.4] - 2026-09-28

### 界面更新
- 正式应用采用 UI Demo 的紧凑工具栏：打开、保存和常用格式操作直接可见，其他操作收纳至“插入”“更多”菜单。
- 顶部增加保存状态，并提供预览、源码及分屏切换入口；原有文件、编辑功能保持可用。

### 验证
- Windows 桌面版发布构建通过；已验证 WebView2 启动、文件打开、编辑保存及单实例多文件打开。

## [0.1.3] - 2026-09-24

### 新增
- 桌面版启动时可提示 GitHub 正式版更新，也可通过“帮助 → 检查更新”手动检查；安装仍需用户确认。
- 新增独立 UI 方案演示，首页 README 提供预览图与入口。

### 改进
- 文档元数据与重新加载入口移至状态栏。
- 完善项目文档及社区反馈、贡献模板。

## [0.1.2] - 2026-09-24

### 修复
- 修复 Inno Setup 构建因缺少简体中文语言文件而失败的问题；安装向导暂时使用默认语言，应用界面仍为中文。
- 发布 Windows x64 单文件安装程序及 SHA-256 校验文件。安装包包含离线 WebView2 Runtime，应用以自包含方式发布，无需用户安装 .NET SDK。

## [0.1.1] - 2026-09-24

### 修复
- 使用微软官方 WebView2 x64 独立离线安装程序下载入口，并增加文件大小与数字签名校验。
- 修正安装程序资源路径、运行时检测以及安装脚本的 Windows PowerShell 编码问题。

## [0.1.0] - 2026-09-24

### 性能优化
- 减少滚动时大纲跟踪的布局计算与额外动画；字数统计复用计算结果。
- 降低本地文件监控、服务器文件监控和会话持久化的轮询频率；窗口重新获得焦点时仍会立即检查文件变化。

### 说明
- 外部文件修改的定时发现可能略有延迟；手动打开、重载和保存功能不受影响。

[0.1.5]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.5
[0.1.4]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.4
[0.1.3]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.3
[0.1.2]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.2
[0.1.1]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.1
[0.1.0]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.0
