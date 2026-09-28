# 性能上下文

## 敏感路径

- `js/editor.js` 的输入同步、Markdown/HTML 转换、DOM 增强、分屏滚动和大纲重建；大文档反复触发布局或整树渲染可能产生明显卡顿。
- `js/ui.js` 的滚动时标题跟踪和 minimap 更新；`js/files.js` 的文件监控及会话落盘；`js/history.js` 的快照读写。
- `desktop/MainForm.cs` 在初始化时计算打包 `app/` 的内容哈希并按版本清理 WebView2 磁盘缓存；这属于启动路径，修改时注意文件数量及 IO 成本。

## 已有控制手段

- `js/editor.js` 的编辑刷新延迟按内容长度分级：超过 1,000,000 字符为 850 毫秒，超过 250,000 字符为 550 毫秒，其余为 350 毫秒；优先使用 `requestIdleCallback`，无支持时回退到 `setTimeout`。大纲更新由 120 毫秒定时器合并。
- `js/ui.js` 用 `requestAnimationFrame` 合并 minimap 更新与刷新，并用定时器控制标题跟踪频率。`js/files.js` 本地轮询每 5 秒、服务端轮询每 3 秒、会话持久化每 15 秒；窗口获得焦点或重新可见时会立即检查。调整周期时要兼顾延迟与后台开销。
- `js/history.js` 自动快照延迟 1500 毫秒，并限制每个文件最多 30 个版本；不要让编辑输入同步等待 IndexedDB。

## 测量与限制

`desktop/performance-smoke.ps1` 对**已安装**的 `MDViewer.exe` 按空闲前、打开文档、空闲后三个阶段采样 CPU、内存、线程、句柄与响应状态，输出 `desktop/performance-results.json`。默认文档路径指向仓库父目录中符合 `Arista_Juniper_Cisco_Load_Balance*.md` 的文件；不存在时必须通过 `-DocumentPath` 明确指定测试文件。当前仓库没有固定基线或自动判定阈值；跨版本比较应记录文档大小、机器、采样参数及进程状态，不能凭一次采样声称性能提升。
