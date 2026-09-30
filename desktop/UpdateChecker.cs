using System.Net;
using System.Security.Cryptography;

namespace MDViewer.Desktop;

internal static class UpdateChecker
{
    private const string LatestPage = "https://github.com/frankieshaw21/MD-VIEWER/releases/latest";
    private const string Releases = "https://github.com/frankieshaw21/MD-VIEWER/releases";
    private static readonly HttpClient Client = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        { Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("MDViewer/1.0");
        return client;
    }

    internal static string CurrentVersion => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "app", "VERSION")).Trim();

    internal static async Task<(string Version, string Url)?> GetLatestAsync()
    {
        // The website redirects /releases/latest to the published tag without
        // consuming the unauthenticated GitHub API rate limit.
        using var request = new HttpRequestMessage(HttpMethod.Get, LatestPage);
        using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
        if (response.StatusCode != HttpStatusCode.Found || response.Headers.Location is null)
        {
            response.EnsureSuccessStatusCode();
            throw new InvalidOperationException("无法获取最新发布版本的跳转地址。");
        }
        var uri = new Uri(new Uri(LatestPage), response.Headers.Location);
        const string tagPrefix = "/frankieshaw21/MD-VIEWER/releases/tag/";
        if (uri.Scheme != Uri.UriSchemeHttps || uri.Host != "github.com" ||
            !uri.AbsolutePath.StartsWith(tagPrefix, StringComparison.OrdinalIgnoreCase) ||
            uri.Query.Length != 0 || uri.Fragment.Length != 0)
            throw new InvalidOperationException("发布页面地址无效。");
        var tag = uri.AbsolutePath[tagPrefix.Length..];
        if (!tag.StartsWith('v') || !Version.TryParse(tag[1..], out var latest) ||
            !Version.TryParse(CurrentVersion, out var current) || latest <= current) return null;
        return (tag, uri.AbsoluteUri);
    }

    internal static async Task<string> DownloadInstallerAsync(string tag, IProgress<int>? progress = null)
    {
        if (!tag.StartsWith('v') || !Version.TryParse(tag[1..], out var version))
            throw new InvalidOperationException("更新版本无效。");
        var fileName = $"MDViewer-Setup-{version}-win-x64.exe";
        var baseUrl = $"https://github.com/frankieshaw21/MD-VIEWER/releases/download/{tag}/{fileName}";
        var updateDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MDViewer", "updates");
        Directory.CreateDirectory(updateDirectory);
        var target = Path.Combine(updateDirectory, fileName);
        var temporary = target + ".download";
        using var client = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        client.DefaultRequestHeaders.UserAgent.ParseAdd("MDViewer/1.0");
        using var checksumResponse = await client.GetAsync(baseUrl + ".sha256");
        checksumResponse.EnsureSuccessStatusCode();
        var expected = (await checksumResponse.Content.ReadAsStringAsync()).Split((char[]?)null,
            StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
        if (expected is null || expected.Length != 64 || !expected.All(Uri.IsHexDigit))
            throw new InvalidOperationException("更新包校验文件无效。");
        using var response = await client.GetAsync(baseUrl, HttpCompletionOption.ResponseHeadersRead);
        response.EnsureSuccessStatusCode();
        var total = response.Content.Headers.ContentLength;
        await using (var input = await response.Content.ReadAsStreamAsync())
        await using (var output = File.Create(temporary))
        {
            var buffer = new byte[81920];
            long downloaded = 0;
            int read;
            while ((read = await input.ReadAsync(buffer)) > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, read));
                downloaded += read;
                if (total is > 0) progress?.Report((int)Math.Min(99, downloaded * 100 / total.Value));
            }
        }
        string actual;
        await using (var downloadedFile = File.OpenRead(temporary))
            actual = Convert.ToHexString(await SHA256.HashDataAsync(downloadedFile));
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
        {
            File.Delete(temporary);
            throw new InvalidOperationException("更新包校验失败，下载已删除。");
        }
        File.Move(temporary, target, true);
        progress?.Report(100);
        return target;
    }

    internal static string ReleasesUrl => Releases;
}
