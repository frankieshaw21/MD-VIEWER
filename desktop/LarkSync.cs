using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MDViewer.Desktop;

// Manual sync only. Never retry a failed overwrite without a fresh revision.
internal static class LarkSync
{
    private sealed record Baseline(long Revision, string Hash);
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    internal static async Task<object> SyncAsync(string path, string url, string direction)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            !(uri.Host.EndsWith(".feishu.cn", StringComparison.OrdinalIgnoreCase) || uri.Host.EndsWith(".larksuite.com", StringComparison.OrdinalIgnoreCase)) ||
            !(uri.AbsolutePath.StartsWith("/docx/") || uri.AbsolutePath.StartsWith("/wiki/")))
            throw new InvalidOperationException("请输入有效的飞书 Wiki / Docx HTTPS 链接。");
        if (direction != "push" && direction != "pull") throw new InvalidOperationException("无效的同步方向。");
        if (!await Gate.WaitAsync(0)) throw new InvalidOperationException("另一个飞书同步正在进行。");
        try
        {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MDViewer", "lark-sync");
            Directory.CreateDirectory(directory);
            var statePath = Path.Combine(directory, Hash(Path.GetFullPath(path).ToUpperInvariant() + "\n" + uri.GetLeftPart(UriPartial.Path)) + ".json");
            var baseline = File.Exists(statePath) ? JsonSerializer.Deserialize<Baseline>(await File.ReadAllTextAsync(statePath)) : null;
            var local = await File.ReadAllTextAsync(path);
            var localHash = Hash(local);
            var remote = await RunAsync("docs", "+fetch", "--doc", url, "--doc-format", "markdown", "--detail", "simple", "--as", "user", "--format", "json");
            var document = remote.GetProperty("data").GetProperty("document");
            var revision = document.GetProperty("revision_id").ValueKind == JsonValueKind.String
                ? long.Parse(document.GetProperty("revision_id").GetString()!) : document.GetProperty("revision_id").GetInt64();
            var remoteContent = document.GetProperty("content");
            if (remoteContent.ValueKind != JsonValueKind.String)
                throw new InvalidOperationException("飞书返回的 Markdown 内容无效，未覆盖本地文件。");
            var content = remoteContent.GetString()!;
            if (baseline != null && local != content && (direction == "push" ? revision != baseline.Revision : localHash != baseline.Hash))
                throw new InvalidOperationException("同步冲突：目标文档自上次同步后已修改，未覆盖任何内容。请先在飞书与本地手动核对、合并；可换用新文档建立映射。");
            if (Hash(await File.ReadAllTextAsync(path)) != localHash)
                throw new InvalidOperationException("同步期间本地文件发生变化，请重试。");
            string? backup = null;
            if (direction == "push")
            {
                // Upload an immutable snapshot, not a file that the editor may change meanwhile.
                var snapshot = Path.Combine(directory, Guid.NewGuid().ToString("N") + ".md");
                try
                {
                    await File.WriteAllTextAsync(snapshot, local, new UTF8Encoding(false));
                    var result = await RunAsync("docs", "+update", "--doc", url, "--command", "overwrite", "--doc-format", "markdown", "--content", "@" + snapshot, "--revision-id", revision.ToString(), "--as", "user", "--format", "json");
                    var data = result.GetProperty("data");
                    if (data.TryGetProperty("result", out var status) && status.GetString() == "failed") throw new InvalidOperationException("飞书拒绝更新，未推进同步基线。");
                    var value = data.GetProperty("document").GetProperty("revision_id");
                    revision = value.ValueKind == JsonValueKind.String ? long.Parse(value.GetString()!) : value.GetInt64();
                }
                finally { File.Delete(snapshot); }
            }
            else
            {
                backup = path + ".lark-backup-" + Guid.NewGuid().ToString("N") + ".md";
                File.Copy(path, backup, false);
                await File.WriteAllTextAsync(path, content, new UTF8Encoding(false));
                localHash = Hash(content);
            }
            var temporary = statePath + ".tmp";
            await File.WriteAllTextAsync(temporary, JsonSerializer.Serialize(new Baseline(revision, localHash)));
            File.Move(temporary, statePath, true);
            return new { direction, backup, revision };
        }
        finally { Gate.Release(); }
    }

    private static async Task<JsonElement> RunAsync(params string[] arguments)
    {
        // PowerShell resolves Windows npm .cmd shims as well as native executables.
        // Encode a script with literal, escaped arguments; never interpolate shell syntax from a URL.
        static string Literal(string value) => "'" + value.Replace("'", "''") + "'";
        var cli = Environment.GetEnvironmentVariable("LARK_MD_SYNC_CLI") ?? "lark-cli";
        var script = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); " +
            "$command=Get-Command -Name " + Literal(cli) + " -ErrorAction SilentlyContinue; " +
            "if ($null -eq $command) {[Console]::Error.WriteLine('[MDVIEWER_CLI_NOT_FOUND]'); exit 127}; " +
            "& $command " + string.Join(" ", arguments.Select(Literal)) + "; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }";
        var start = new ProcessStartInfo("powershell.exe")
        { UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8 };
        foreach (var argument in new[] { "-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Convert.ToBase64String(Encoding.Unicode.GetBytes(script)) }) start.ArgumentList.Add(argument);
        using var process = Process.Start(start) ?? throw new InvalidOperationException("无法启动 lark-cli，请安装并完成用户授权。");
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        using var timeout = new CancellationTokenSource(TimeSpan.FromMinutes(2));
        try { await process.WaitForExitAsync(timeout.Token); }
        catch (OperationCanceledException) { process.Kill(true); throw new InvalidOperationException("飞书操作超时；上传可能已生效，请核对远端后再操作。"); }
        var output = await stdout;
        var error = await stderr;
        if (process.ExitCode != 0)
            throw new InvalidOperationException(FailureReason(output + "\n" + error, process.ExitCode));
        JsonDocument json;
        try { json = JsonDocument.Parse(output); }
        catch (JsonException) { throw new InvalidOperationException("飞书命令返回了无法识别的数据，请更新 lark-cli 后重试。"); }
        using (json)
        {
            if (!json.RootElement.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True)
                throw new InvalidOperationException(FailureReason(output, null));
            return json.RootElement.Clone();
        }
    }

    // Raw stderr can contain CLIXML, tokens or document content. Never display it.
    internal static string FailureReason(string detail, int? exitCode)
    {
        var text = detail.ToLowerInvariant();
        if (text.Contains("mdviewer_cli_not_found") || text.Contains("commandnotfoundexception"))
            return "未找到 lark-cli。请按下方教程安装，安装后重启 MD Viewer。";
        if (text.Contains("scope") || text.Contains("permission") || text.Contains("forbidden") || text.Contains("99991672") || text.Contains("权限"))
            return "没有文档访问权限或缺少授权范围。请检查文档共享权限，并重新授权云文档读写权限。";
        if (text.Contains("unauthorized") || text.Contains("not logged") || text.Contains("login required") || text.Contains("token") || text.Contains("99991663") || text.Contains("未登录"))
            return "飞书尚未授权或登录已过期。请按下方教程重新登录授权。";
        if (text.Contains("not found") || text.Contains("404"))
            return "飞书文档不存在或链接已失效，请检查文档链接。";
        if (text.Contains("network") || text.Contains("timeout") || text.Contains("connection") || text.Contains("dns") || text.Contains("网络"))
            return "无法连接飞书，请检查网络或代理后重试。";
        return exitCode.HasValue
            ? $"飞书命令执行失败（退出码 {exitCode}）。请先检查授权状态，再重试。"
            : "飞书拒绝了本次操作。请检查授权状态和文档权限后重试。";
    }
}
