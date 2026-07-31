' MD Viewer launcher - fully hidden, no console window
Option Explicit
Dim shell, fso, here, ps, url, edge, edgePaths, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:8899/md-viewer.html"

' 1) Start the local server hidden (window style 0 = hidden, don't wait)
ps = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\md-viewer-server.ps1"""
shell.Run ps, 0, False

' 2) Give the server a moment to start
WScript.Sleep 800

' 3) Find Edge and open in app mode (independent window)
edgePaths = Array( _
  shell.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe", _
  shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\Microsoft\Edge\Application\msedge.exe" _
)

edge = ""
For i = 0 To UBound(edgePaths)
  If fso.FileExists(edgePaths(i)) Then
    edge = edgePaths(i)
    Exit For
  End If
Next

If edge <> "" Then
  shell.Run """" & edge & """ --app=" & url & " --window-size=1200,800", 1, False
Else
  ' Fallback: default browser
  shell.Run url, 1, False
End If
