import { spawn } from "node:child_process";

// Electron has no event for other processes entering fullscreen on Windows.
// One hidden observer reports only state changes; no renderer receives HWNDs.
export function observeFullscreen(changed: (fullscreen: boolean) => void): () => void {
    if (process.platform !== "win32") return () => {};
    const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class MiniFullscreen {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Info { public int Size; public Rect Monitor, Work; public uint Flags; }
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    public static void Initialize() { SetProcessDPIAware(); }
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect rect);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern bool GetMonitorInfo(IntPtr monitor, ref Info info);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern int GetClassName(IntPtr h, StringBuilder name, int count);
    public static bool Active() {
        var h = GetForegroundWindow();
        if (h == IntPtr.Zero || !IsWindowVisible(h) || IsIconic(h)) return false;
        var name = new StringBuilder(256); GetClassName(h, name, name.Capacity);
        if (name.ToString() == "Progman" || name.ToString() == "WorkerW" || name.ToString() == "Shell_TrayWnd") return false;
        Rect r; if (!GetWindowRect(h, out r)) return false;
        var info = new Info(); info.Size = Marshal.SizeOf(typeof(Info));
        if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref info)) return false;
        var m = info.Monitor;
        return Math.Abs(r.Left-m.Left) <= 2 && Math.Abs(r.Top-m.Top) <= 2 && Math.Abs(r.Right-m.Right) <= 2 && Math.Abs(r.Bottom-m.Bottom) <= 2;
    }
}
'@
[MiniFullscreen]::Initialize()
$previous = ''
while ($true) {
    $current = if ([MiniFullscreen]::Active()) { '1' } else { '0' }
    if ($current -ne $previous) { Write-Output $current; $previous = $current }
    Start-Sleep -Milliseconds 500
}
`;
    const observer = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-OutputFormat", "Text", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let buffer = "", diagnostic = "", disposed = false;
    observer.stdout.setEncoding("utf8");
    observer.stdout.on("data", (chunk: string) => {
        if (disposed) return;
        buffer += chunk;
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
        for (const line of lines) if (line === "0" || line === "1") changed(line === "1");
    });
    observer.stderr.on("data", chunk => { diagnostic = (diagnostic + String(chunk)).slice(-2000); });
    const failed = (error: unknown) => { if (!disposed) { console.error("Fullscreen observer unavailable", error); changed(false); } };
    observer.on("error", failed);
    observer.on("exit", code => { if (!disposed) failed(diagnostic || `Observer exited (${code})`); });
    return () => { disposed = true; observer.kill(); };
}
