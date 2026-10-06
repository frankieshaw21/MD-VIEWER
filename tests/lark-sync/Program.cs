using MDViewer.Desktop;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

var temp = Path.Combine(Path.GetTempPath(), "mdviewer-lark-test-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
var path = Path.Combine(temp, "中文 文档.md");
var remote = Path.Combine(temp, "remote.json");
var cli = Path.Combine(temp, "mock.ps1");
var url = "https://test.feishu.cn/docx/test";
var state = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "MDViewer", "lark-sync",
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(path).ToUpperInvariant() + "\n" + url))) + ".json");
var oldCli = Environment.GetEnvironmentVariable("LARK_MD_SYNC_CLI");
try
{
    await File.WriteAllTextAsync(cli, """
param([Parameter(ValueFromRemainingArguments=$true)][string[]]$a)
$r = Get-Content -LiteralPath $env:MDVIEWER_MOCK_REMOTE -Raw -Encoding UTF8 | ConvertFrom-Json
if ($r.mode -eq 'failure') { exit 3 }
if ($r.mode -eq 'malformed') { Write-Output 'not json'; exit 0 }
if ($r.mode -eq 'nullcontent') { $r.content = $null }
if ($r.mode -eq 'delay') { Start-Sleep -Seconds 2 }
if ($a[1] -eq '+update') {
  if ($r.mode -eq 'updatefailure') { @{ok=$true;data=@{result='failed'}} | ConvertTo-Json -Depth 5 -Compress; exit 0 }
  if ($r.mode -eq 'revisionrace') { exit 4 }
  $rev = $a[[Array]::IndexOf($a, '--revision-id') + 1]
  if ([long]$rev -ne $r.revision_id) { exit 4 }
  $p = $a[[Array]::IndexOf($a, '--content') + 1].Substring(1)
  $r.content = [IO.File]::ReadAllText($p)
  $r.revision_id++
  [IO.File]::WriteAllText($env:MDVIEWER_MOCK_REMOTE, ($r | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
}
@{ok=$true;data=@{document=$r;result='success'}} | ConvertTo-Json -Depth 5 -Compress
""");
    Environment.SetEnvironmentVariable("LARK_MD_SYNC_CLI", cli);
    Environment.SetEnvironmentVariable("MDVIEWER_MOCK_REMOTE", remote);
    async Task Remote(long revision, string content, string mode = "ok") => await File.WriteAllTextAsync(remote, JsonSerializer.Serialize(new { revision_id = revision, content, mode }));
    async Task Reject(string direction) {
        try { await LarkSync.SyncAsync(path, url, direction); }
        catch (InvalidOperationException) { return; }
        throw new Exception("Expected conflict rejection");
    }
    await File.WriteAllTextAsync(path, "本地 initial");
    await Remote(1, "远端");
    await LarkSync.SyncAsync(path, url, "push");
    if (!File.ReadAllText(remote).Contains("initial")) throw new Exception("Upload failed");
    await Remote(3, "remote changed");
    await Reject("push");
    await LarkSync.SyncAsync(path, url, "pull");
    if (File.ReadAllText(path) != "remote changed" || Directory.GetFiles(temp, "*.lark-backup-*.md").Length != 1) throw new Exception("Pull/backup failed");
    await File.WriteAllTextAsync(path, "local changed");
    await Remote(4, "both changed");
    await Reject("pull");
    await Reject("push");
    if (File.ReadAllText(path) != "local changed") throw new Exception("Conflict overwrote local");
    Console.WriteLine("PASS: initial upload, pull/backup, revision conflict, local conflict, Unicode local path");
    var baseline = await File.ReadAllTextAsync(state);
    await File.WriteAllTextAsync(path, "remote changed");
    foreach (var mode in new[] { "failure", "updatefailure", "revisionrace" })
    {
        await Remote(3, "remote changed", mode);
        await Reject("push");
        if (await File.ReadAllTextAsync(state) != baseline) throw new Exception("Failed push advanced baseline");
    }
    Console.WriteLine("PASS: failed CLI/update/revision race never advance baseline");
    await Remote(5, "fetch content", "delay");
    var sync = LarkSync.SyncAsync(path, url, "pull");
    await Task.Delay(500);
    await Reject("pull"); // Global single-flight guard, not a second download.
    await File.WriteAllTextAsync(path, "edited during fetch");
    try { await sync; throw new Exception("Expected local race rejection"); }
    catch (InvalidOperationException) { }
    if (await File.ReadAllTextAsync(path) != "edited during fetch" || await File.ReadAllTextAsync(state) != baseline)
        throw new Exception("Local race lost edits or advanced baseline");
    Console.WriteLine("PASS: single-flight guard and local edit during fetch");
    await File.WriteAllTextAsync(path, "remote changed");
    await Remote(6, "placeholder", "nullcontent");
    await Reject("pull");
    if (await File.ReadAllTextAsync(path) != "remote changed" || await File.ReadAllTextAsync(state) != baseline)
        throw new Exception("Null remote content overwrote local or advanced baseline");
    Console.WriteLine("PASS: invalid remote null content is not an empty document");
    await Remote(6, "manually reconciled");
    await File.WriteAllTextAsync(path, "manually reconciled");
    await LarkSync.SyncAsync(path, url, "push");
    Console.WriteLine("PASS: matching contents recover baseline after manual reconciliation");
    File.Delete(state);
    await File.WriteAllTextAsync(path, "initial download backup");
    await Remote(10, "first download");
    await LarkSync.SyncAsync(path, url, "pull");
    if (await File.ReadAllTextAsync(path) != "first download" ||
        !Directory.GetFiles(temp, "*.lark-backup-*.md").Any(p => File.ReadAllText(p) == "initial download backup"))
        throw new Exception("Initial pull did not back up local content");
    await Remote(11, "");
    await LarkSync.SyncAsync(path, url, "pull");
    if (await File.ReadAllTextAsync(path) != "") throw new Exception("Valid empty document rejected");
    Console.WriteLine("PASS: first download backs up local; valid empty Markdown accepted");
}
finally
{
    Environment.SetEnvironmentVariable("LARK_MD_SYNC_CLI", oldCli);
    Environment.SetEnvironmentVariable("MDVIEWER_MOCK_REMOTE", null);
    File.Delete(state);
    Directory.Delete(temp, true);
}
