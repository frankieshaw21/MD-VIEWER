using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace MDViewer.Desktop;

internal sealed class MainForm : Form
{
    private readonly WebView2 _webView = new() { Dock = DockStyle.Fill };
    private readonly Queue<string[]> _pendingPaths = new();
    private readonly HashSet<string> _allowedPaths = new(StringComparer.OrdinalIgnoreCase);
    private readonly string _trustedPathsFile;
    private bool _pageReady;
    private bool _allowClose;
    private bool _closeCheckInProgress;

    public MainForm(string[] initialPaths, SingleInstanceCoordinator instance)
    {
        Text = "MD Viewer";
        Width = 1280;
        Height = 820;
        MinimumSize = new Size(800, 560);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(_webView);
        _trustedPathsFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MDViewer", "trusted-files.json");
        LoadTrustedPaths();
        Grant(initialPaths);
        _pendingPaths.Enqueue(initialPaths);
        instance.PathsReceived += paths => BeginInvoke(new Action(() => ReceivePaths(paths)));
        Load += async (_, _) => await InitializeWebViewAsync();
        FormClosing += HandleFormClosing;
    }

    private async Task InitializeWebViewAsync()
    {
        var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MDViewer", "WebView2");
        var appFolder = Path.Combine(AppContext.BaseDirectory, "app");
        var contentVersion = ComputeContentVersion(appFolder);
        var environment = await CoreWebView2Environment.CreateAsync(null, dataFolder);
        await _webView.EnsureCoreWebView2Async(environment);
        var core = _webView.CoreWebView2;
        await RefreshAssetCacheAsync(core, dataFolder, contentVersion);
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsWebMessageEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.SetVirtualHostNameToFolderMapping("mdviewer.local", appFolder, CoreWebView2HostResourceAccessKind.DenyCors);
        core.WebMessageReceived += HandleWebMessage;
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri) && !uri.Host.Equals("mdviewer.local", StringComparison.OrdinalIgnoreCase))
            {
                e.Cancel = true;
                OpenExternal(e.Uri);
            }
        };
        _webView.Source = new Uri($"https://mdviewer.local/md-viewer.html?v={contentVersion}");
    }

    private static string ComputeContentVersion(string appFolder)
    {
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[64 * 1024];
        foreach (var path in Directory.EnumerateFiles(appFolder, "*", SearchOption.AllDirectories)
                     .OrderBy(path => Path.GetRelativePath(appFolder, path), StringComparer.OrdinalIgnoreCase))
        {
            var relativePath = Path.GetRelativePath(appFolder, path).Replace('\\', '/');
            hash.AppendData(Encoding.UTF8.GetBytes(relativePath));
            using var stream = File.OpenRead(path);
            int read;
            while ((read = stream.Read(buffer, 0, buffer.Length)) > 0) hash.AppendData(buffer, 0, read);
        }
        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant()[..16];
    }

    private static async Task RefreshAssetCacheAsync(CoreWebView2 core, string dataFolder, string contentVersion)
    {
        var markerPath = Path.Combine(dataFolder, "asset-version.txt");
        string? previousVersion = null;
        try { if (File.Exists(markerPath)) previousVersion = await File.ReadAllTextAsync(markerPath); }
        catch { }
        if (string.Equals(previousVersion?.Trim(), contentVersion, StringComparison.Ordinal)) return;
        try { await core.Profile.ClearBrowsingDataAsync(CoreWebView2BrowsingDataKinds.DiskCache); }
        catch { }
        try
        {
            Directory.CreateDirectory(dataFolder);
            await File.WriteAllTextAsync(markerPath, contentVersion, new UTF8Encoding(false));
        }
        catch { }
    }

    private async void HandleWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string? id = null;
        try
        {
            using var document = JsonDocument.Parse(e.WebMessageAsJson);
            var root = document.RootElement;
            var kind = GetString(root, "kind");
            if (kind == "ready")
            {
                _pageReady = true;
                while (_pendingPaths.TryDequeue(out var paths)) SendPaths(paths);
                return;
            }
            if (kind == "title")
            {
                Text = string.IsNullOrWhiteSpace(GetString(root, "value")) ? "MD Viewer" : GetString(root, "value") + " — MD Viewer";
                return;
            }
            if (kind != "request") return;
            id = GetString(root, "id");
            var action = GetString(root, "action");
            switch (action)
            {
                case "open-dialog":
                    using (var dialog = new OpenFileDialog
                    {
                        Filter = "Markdown 文档|*.md;*.markdown;*.txt|所有文件|*.*",
                        Multiselect = true,
                        Title = "打开 Markdown 文件"
                    })
                    {
                        var paths = dialog.ShowDialog(this) == DialogResult.OK ? dialog.FileNames : Array.Empty<string>();
                        Grant(paths);
                        Reply(id, paths);
                    }
                    break;
                case "read-file":
                    var readPath = RequireAllowedPath(GetString(root, "path"));
                    var info = new FileInfo(readPath);
                    Reply(id, new { path = readPath, name = info.Name, content = await File.ReadAllTextAsync(readPath), lastModified = info.LastWriteTimeUtc.ToFileTimeUtc() / 10000 - 11644473600000, size = info.Length });
                    break;
                case "write-file":
                    var writePath = RequireAllowedPath(GetString(root, "path"));
                    await File.WriteAllTextAsync(writePath, GetString(root, "content"), new UTF8Encoding(false));
                    var written = new FileInfo(writePath);
                    Reply(id, new { lastModified = written.LastWriteTimeUtc.ToFileTimeUtc() / 10000 - 11644473600000, size = written.Length });
                    break;
                case "stat-file":
                    var statPath = RequireAllowedPath(GetString(root, "path"));
                    var stat = new FileInfo(statPath);
                    Reply(id, new { exists = stat.Exists, lastModified = stat.Exists ? stat.LastWriteTimeUtc.ToFileTimeUtc() / 10000 - 11644473600000 : 0, size = stat.Exists ? stat.Length : 0 });
                    break;
                case "choose-default":
                    FileAssociations.OpenDefaultApps();
                    Reply(id, true);
                    break;
                default:
                    throw new InvalidOperationException("不支持的桌面操作：" + action);
            }
        }
        catch (Exception error)
        {
            Reply(id, null, error.Message);
        }
    }

    private void ReceivePaths(string[] paths)
    {
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Show();
        Activate();
        Grant(paths);
        if (_pageReady) SendPaths(paths); else _pendingPaths.Enqueue(paths);
    }

    private void SendPaths(string[] paths)
    {
        if (!_pageReady || paths.Length == 0) return;
        Post(new { kind = "open-files", paths });
    }

    private void Grant(IEnumerable<string> paths)
    {
        var changed = false;
        foreach (var path in paths)
        {
            try
            {
                var full = Path.GetFullPath(path);
                if (File.Exists(full) && IsSupported(full)) changed |= _allowedPaths.Add(full);
            }
            catch { }
        }
        if (changed) SaveTrustedPaths();
    }

    private string RequireAllowedPath(string path)
    {
        var full = Path.GetFullPath(path);
        if (!_allowedPaths.Contains(full)) throw new UnauthorizedAccessException("该文件路径尚未由用户授权。请通过“打开文件”重新选择。");
        if (!IsSupported(full)) throw new InvalidOperationException("仅支持 Markdown 和文本文件。");
        return full;
    }

    private static bool IsSupported(string path) => Path.GetExtension(path).ToLowerInvariant() is ".md" or ".markdown" or ".txt";

    private void LoadTrustedPaths()
    {
        try
        {
            if (!File.Exists(_trustedPathsFile)) return;
            foreach (var path in JsonSerializer.Deserialize<string[]>(File.ReadAllText(_trustedPathsFile)) ?? Array.Empty<string>())
                if (File.Exists(path) && IsSupported(path)) _allowedPaths.Add(Path.GetFullPath(path));
        }
        catch { }
    }

    private void SaveTrustedPaths()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(_trustedPathsFile)!);
            File.WriteAllText(_trustedPathsFile, JsonSerializer.Serialize(_allowedPaths.OrderBy(path => path)));
        }
        catch { }
    }

    private async void HandleFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_allowClose || !_pageReady) return;
        e.Cancel = true;
        if (_closeCheckInProgress) return;
        _closeCheckInProgress = true;
        try
        {
            var savePending = false;
            for (var attempt = 0; attempt < 600; attempt++)
            {
                var pendingResult = await _webView.CoreWebView2.ExecuteScriptAsync(
                    "(function(){var f=window.MDViewer&&MDViewer.app&&MDViewer.app.getPort('files');return Boolean(f&&typeof f.isSavePending==='function'&&f.isSavePending());})()");
                savePending = pendingResult == "true";
                if (!savePending) break;
                await Task.Delay(50);
            }
            if (savePending)
            {
                MessageBox.Show(this, "文件保存时间过长，尚未完成。请稍后再退出。", "MD Viewer",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            var namesResult = await _webView.CoreWebView2.ExecuteScriptAsync(
                "(function(){var f=window.MDViewer&&MDViewer.app&&MDViewer.app.getPort('files');" +
                "if(!f)return [];if(typeof f.getUnsavedFileNames==='function')return f.getUnsavedFileNames();" +
                "return f.hasUnsavedChanges()?['当前文档']:[];})()");
            var unsavedNames = JsonSerializer.Deserialize<string[]>(namesResult) ?? Array.Empty<string>();
            var exitMode = "clean";
            if (unsavedNames.Length > 0)
            {
                var visibleNames = unsavedNames.Take(8).Select(name => "• " + name).ToList();
                if (unsavedNames.Length > visibleNames.Count)
                    visibleNames.Add($"• 以及其他 {unsavedNames.Length - visibleNames.Count} 个文件");
                var answer = MessageBox.Show(this,
                    "以下文件仍有未保存的更改：\n\n" + string.Join("\n", visibleNames) +
                    "\n\n是否放弃这些更改并退出？\n选择“否”可返回继续保存。",
                    "MD Viewer", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2);
                if (answer != DialogResult.Yes) return;
                exitMode = "discard";
            }

            var prepareResult = await _webView.CoreWebView2.ExecuteScriptAsync(
                "(function(){var f=window.MDViewer&&MDViewer.app&&MDViewer.app.getPort('files');" +
                $"return Boolean(f&&typeof f.prepareExit==='function'&&f.prepareExit('{exitMode}'));}})()");
            if (prepareResult != "true")
            {
                MessageBox.Show(this, "无法安全准备退出，会话状态未写入。已取消退出。",
                    "MD Viewer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _allowClose = true;
            Close();
        }
        catch (Exception error)
        {
            MessageBox.Show(this, "无法确认文档保存状态，已取消退出。\n\n" + error.Message,
                "MD Viewer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
        finally
        {
            _closeCheckInProgress = false;
        }
    }

    private void Reply(string? id, object? data = null, string? error = null)
    {
        if (string.IsNullOrWhiteSpace(id) || _webView.CoreWebView2 is null) return;
        Post(new { kind = "response", id, ok = error is null, data, error });
    }

    private void Post(object message) => _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));

    private static string GetString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() ?? "" : "";

    private static void OpenExternal(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
    }
}
