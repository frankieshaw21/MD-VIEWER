using System.IO.Pipes;
using System.Text.Json;

namespace MDViewer.Desktop;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        if (args.Contains("--register", StringComparer.OrdinalIgnoreCase))
        {
            FileAssociations.Register();
            return;
        }
        if (args.Contains("--unregister", StringComparer.OrdinalIgnoreCase))
        {
            FileAssociations.Unregister();
            return;
        }

        var paths = args.Where(IsMarkdownPath).Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
        using var instance = new SingleInstanceCoordinator();
        if (!instance.IsPrimary)
        {
            instance.Forward(paths);
            return;
        }

        Application.Run(new MainForm(paths, instance));
    }

    private static bool IsMarkdownPath(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || !File.Exists(value)) return false;
        return Path.GetExtension(value).ToLowerInvariant() is ".md" or ".markdown" or ".txt";
    }
}

internal sealed class SingleInstanceCoordinator : IDisposable
{
    private const string MutexName = "Local\\MDViewer.Desktop.SingleInstance";
    private const string PipeName = "MDViewer.Desktop.OpenFiles";
    private readonly Mutex _mutex;
    private readonly CancellationTokenSource _shutdown = new();

    public bool IsPrimary { get; }
    public event Action<string[]>? PathsReceived;

    public SingleInstanceCoordinator()
    {
        _mutex = new Mutex(true, MutexName, out var createdNew);
        IsPrimary = createdNew;
        if (createdNew) _ = ListenAsync();
    }

    public void Forward(string[] paths)
    {
        try
        {
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.Out);
            client.Connect(2500);
            using var writer = new StreamWriter(client) { AutoFlush = true };
            writer.WriteLine(JsonSerializer.Serialize(paths));
        }
        catch
        {
            MessageBox.Show("无法连接到已运行的 MD Viewer，请稍后重试。", "MD Viewer", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        }
    }

    private async Task ListenAsync()
    {
        while (!_shutdown.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(PipeName, PipeDirection.In, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await server.WaitForConnectionAsync(_shutdown.Token);
                using var reader = new StreamReader(server);
                var line = await reader.ReadLineAsync(_shutdown.Token);
                if (!string.IsNullOrWhiteSpace(line))
                {
                    var paths = JsonSerializer.Deserialize<string[]>(line) ?? Array.Empty<string>();
                    PathsReceived?.Invoke(paths);
                }
            }
            catch (OperationCanceledException) { break; }
            catch { await Task.Delay(200); }
        }
    }

    public void Dispose()
    {
        _shutdown.Cancel();
        if (IsPrimary)
        {
            try { _mutex.ReleaseMutex(); } catch { }
        }
        _mutex.Dispose();
        _shutdown.Dispose();
    }
}
