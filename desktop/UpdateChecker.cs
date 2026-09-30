using System.Net;

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

    internal static string ReleasesUrl => Releases;
}
