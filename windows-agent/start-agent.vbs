Option Explicit

Dim shell
Dim fso
Dim args
Dim i
Dim command
Dim powershellPath
Dim scriptPath

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
args = ""

For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & Replace(WScript.Arguments(i), """", """""") & """"
Next

powershellPath = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "start-agent.ps1")
command = """" & powershellPath & """ -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """" & args

shell.Run command, 0, False
