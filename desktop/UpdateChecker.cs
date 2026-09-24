using System.Net.Http.Headers;
using System.Text.Json;

namespace MDViewer.Desktop;

internal static class UpdateChecker
{
    private const string LatestApi = "https://api.github.com/repos/bwj6wjrtsk-hash/MD-VIEWER/releases/latest";
    private const string Releases = "https://github.com/bwj6wjrtsk-hash/MD-VIEWER/releases";
    private static readonly HttpClient Client = CreateClient();

    private static HttpClient CreateClient()
    {
        var client = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
        client.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("MDViewer", "1.0"));
        client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
        return client;
    }

    internal static string CurrentVersion => File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "app", "VERSION")).Trim();

    internal static async Task<(string Version, string Url)?> GetLatestAsync()
    {
        using var response = await Client.GetAsync(LatestApi);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = document.RootElement;
        var tag = root.GetProperty("tag_name").GetString() ?? "";
        if (!tag.StartsWith('v') || !Version.TryParse(tag[1..], out var latest) ||
            !Version.TryParse(CurrentVersion, out var current) || latest <= current) return null;
        var url = root.GetProperty("html_url").GetString() ?? "";
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme != "https" ||
            uri.Host != "github.com" || !uri.AbsolutePath.StartsWith("/bwj6wjrtsk-hash/MD-VIEWER/releases/tag/", StringComparison.Ordinal))
            throw new InvalidOperationException("发布页面地址无效。");
        // The release page lets users inspect the notes and download the installer themselves.
        return (tag, uri.AbsoluteUri);
    }

    internal static string ReleasesUrl => Releases;
}
