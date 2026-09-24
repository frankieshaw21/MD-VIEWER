#define AppName "MD Viewer"
#define AppVersion GetEnv("APP_VERSION")
#define AppPublisher "MD Viewer"

[Setup]
AppId={{4F259F08-714B-4E56-9615-6E6CF388178C}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\MD Viewer
DefaultGroupName=MD Viewer
DisableProgramGroupPage=yes
OutputDir=publish-installer
OutputBaseFilename=MDViewer-Setup-{#AppVersion}-win-x64
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
UninstallDisplayIcon={app}\MDViewer.exe
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加快捷方式："; Flags: unchecked

[Files]
Source: "publish\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: not IsWebView2Installed

[Icons]
Name: "{group}\MD Viewer"; Filename: "{app}\MDViewer.exe"
Name: "{autodesktop}\MD Viewer"; Filename: "{app}\MDViewer.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebView2RuntimeInstallerX64.exe"; Parameters: "/silent /install"; StatusMsg: "正在安装 WebView2 离线运行组件…"; Flags: waituntilterminated; Check: not IsWebView2Installed
Filename: "{app}\MDViewer.exe"; Description: "启动 MD Viewer"; Flags: postinstall nowait skipifsilent

[Code]
function IsWebView2Installed: Boolean;
var
  Version: string;
begin
  Result := RegQueryStringValue(HKLM64,
    'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '');
  if not Result then
    Result := RegQueryStringValue(HKCU,
      'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '');
end;
