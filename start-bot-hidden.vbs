' Run start-bot.bat invisibly (no console window) on Windows startup
Dim objShell
Set objShell = CreateObject("WScript.Shell")
objShell.Run """" & WScript.Arguments(0) & """", 0, False
Set objShell = Nothing
