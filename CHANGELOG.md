# 更新日志

本项目采用 [语义化版本](https://semver.org/lang/zh-CN/)（`主版本.次版本.修订版本`）。发布版本见 [GitHub Releases](https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases)。

## [未发布]

暂无。

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

[0.1.2]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.2
[0.1.1]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.1
[0.1.0]: https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/v0.1.0
