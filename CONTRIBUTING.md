# 参与贡献

感谢你帮助改进 MD Viewer。提交代码或反馈前，请先阅读 [README.md](README.md) 和 [更新日志](CHANGELOG.md)。

## 报告问题

请使用 GitHub Issues 中的 Bug 报告模板，附上复现步骤、预期与实际结果、Windows 与 WebView2 版本、使用方式（桌面版、便携服务或浏览器）和相关日志。上传截图或示例 Markdown 前请删除敏感信息。安全漏洞请不要提交公开 Issue，参见 [安全政策](SECURITY.md)。

## 提交改动

1. 从当前开发分支创建新分支；一个 PR 尽量只解决一类问题。
2. 描述动机、修改方式、风险和验证步骤。界面变化请附截图；修复缺陷请提供可复现的示例。
3. 保持浏览器离线运行能力；桌面版的构建依赖仅用于开发和发布，不应强制普通用户安装 SDK。
4. 提交前运行可用的检查：

   ```powershell
   Get-ChildItem .\js\*.js | ForEach-Object { node --check $_.FullName }
   powershell -NoProfile -ExecutionPolicy Bypass -File .\desktop\build.ps1
   ```

   第二项需要 Windows 和 .NET 8 SDK；若无法运行，请在 PR 中注明，并说明已完成的手动验证。
5. 对安装、升级或发布流程的改动，请同时更新 README，并说明是否在干净的 Windows 环境中实际验证。

## 版本与发布

版本号保存在 `VERSION`，发布记录在 `CHANGELOG.md`。发布前先更新这两个文件，再创建不可随意改写的 `vX.Y.Z` 标签；标签推送后由 `.github/workflows/release.yml` 构建发布。不要把“CI 构建成功”等同于“已在干净环境验证安装”。

提交消息建议使用 `feat:`, `fix:`, `perf:`, `docs:`, `test:`, `chore:` 等前缀。
