using Microsoft.Win32;
using System.Diagnostics;

namespace MDViewer.Desktop;

internal static class FileAssociations
{
    private const string ProgId = "MDViewer.Markdown";
    private const string AppName = "MD Viewer";

    public static void Register()
    {
        var exe = Environment.ProcessPath ?? Application.ExecutablePath;
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ProgId))
            key.SetValue(null, "Markdown 文档");
        using (var icon = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ProgId + @"\DefaultIcon"))
            icon.SetValue(null, $"\"{exe}\",0");
        using (var command = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + ProgId + @"\shell\open\command"))
            command.SetValue(null, $"\"{exe}\" \"%1\"");

        foreach (var extension in new[] { ".md", ".markdown" })
        {
            using var openWith = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + extension + @"\OpenWithProgids");
            openWith.SetValue(ProgId, Array.Empty<byte>(), RegistryValueKind.None);
        }

        using (var capabilities = Registry.CurrentUser.CreateSubKey(@"Software\MDViewer\Capabilities"))
        {
            capabilities.SetValue("ApplicationName", AppName);
            capabilities.SetValue("ApplicationDescription", "快速、安全的本地 Markdown 阅读与编辑工具");
            using var associations = capabilities.CreateSubKey("FileAssociations");
            associations.SetValue(".md", ProgId);
            associations.SetValue(".markdown", ProgId);
        }
        using var registered = Registry.CurrentUser.CreateSubKey(@"Software\RegisteredApplications");
        registered.SetValue(AppName, @"Software\MDViewer\Capabilities");
    }

    public static void OpenDefaultApps()
    {
        Register();
        try { Process.Start(new ProcessStartInfo("ms-settings:defaultapps?registeredAppUser=MD%20Viewer") { UseShellExecute = true }); }
        catch { Process.Start(new ProcessStartInfo("ms-settings:defaultapps") { UseShellExecute = true }); }
    }

    public static void Unregister()
    {
        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + ProgId, false); } catch { }
        foreach (var extension in new[] { ".md", ".markdown" })
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(@"Software\Classes\" + extension + @"\OpenWithProgids", true);
                key?.DeleteValue(ProgId, false);
            }
            catch { }
        }
        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\MDViewer", false); } catch { }
        try
        {
            using var registered = Registry.CurrentUser.OpenSubKey(@"Software\RegisteredApplications", true);
            registered?.DeleteValue(AppName, false);
        }
        catch { }
    }
}
