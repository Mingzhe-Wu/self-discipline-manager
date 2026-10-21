import { app, BrowserWindow, dialog, Menu, screen, Tray } from "electron";
import path from "node:path";
import { closeDatabase, initializeDatabase } from "./db/database";
import { registerTaskIpc } from "./ipc/taskIpc";
import { createSenderValidator } from "./ipc/validateSender";
import { startTaskScheduler, stopTaskScheduler } from "./scheduler/taskScheduler";

import { getLocalPreferences, getUserSettings } from "./services/settingsService";
import { registerSettingsIpc } from "./ipc/settingsIpc";
import { defaultWindowBounds } from "./window/windowSizing";
import { loadWindowGeometry, trackWindowGeometry } from "./window/windowGeometry";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let fatalErrorReported = false;
let rendererUrl: string;
let startupComplete = false;
let saveWindowGeometry: (() => void) | undefined;

function showMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    const wasVisible = mainWindow.isVisible();
    mainWindow.show();
    mainWindow.focus();
    if (wasVisible) mainWindow.webContents.send("app:shown");
}

async function createWindow() {
    const geometryFile = path.join(app.getPath("userData"), "window-state.json");
    const geometry = loadWindowGeometry(geometryFile, screen.getAllDisplays().map((display) => display.workArea), defaultWindowBounds(screen.getPrimaryDisplay().workArea));
    const window = new BrowserWindow({
        ...geometry.bounds,
        webPreferences: {
            preload: path.join(app.getAppPath(), "out", "preload", "index.mjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: false, // ESM preload requires an unsandboxed preload context.
        },
    });
    window.removeMenu();
    saveWindowGeometry = trackWindowGeometry(window, geometryFile, screen);
    if (geometry.maximized) window.maximize();
    mainWindow = window;
    window.on("show", () => window.webContents.send("app:shown"));
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.webContents.on("will-redirect", (event) => event.preventDefault());
    window.webContents.once("preload-error", (_event, _preloadPath, error) => {
        reportFatalError(error);
    });
    window.on("close", (event) => {
        if (!isQuitting) {
            event.preventDefault();
            if (getUserSettings().closeToTray) window.hide();
            else app.quit();
        }
    });
    window.on("closed", () => {
        if (mainWindow === window) mainWindow = null;
    });
    await window.loadURL(rendererUrl);
}

function createTray() {
    tray = new Tray(path.join(app.getAppPath(), "resources", "tray-icon.png"));
    tray.setToolTip("Self Discipline Manager");
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: "Open", click: showMainWindow },
        { label: "Quit", click: () => app.quit() },
    ]));
    tray.on("double-click", showMainWindow);
}

function cleanup() {
    stopTaskScheduler();
    closeDatabase();
    tray?.destroy();
    tray = null;
}

function reportFatalError(error: unknown) {
    if (fatalErrorReported) return;
    fatalErrorReported = true;
    isQuitting = true;
    console.error("Application startup failed", error);
    try {
        cleanup();
    } catch (cleanupError) {
        console.error("Application cleanup failed", cleanupError);
    }
    dialog.showErrorBox(
        "Self Discipline Manager could not start",
        `${error instanceof Error ? error.message : String(error)}\n\nNo working application was started. Your data is stored in:\n${app.getPath("userData")}`,
    );
    app.exit(1);
}

// Acquire the lock before opening SQLite or starting the reminder scheduler.
if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on("second-instance", showMainWindow);
    app.on("before-quit", () => {
        isQuitting = true;
        if (startupComplete && !fatalErrorReported) saveWindowGeometry?.();
        cleanup();
    });

    app.whenReady().then(async () => {
        if (process.platform === "win32") {
            app.setAppUserModelId(app.isPackaged ? "com.self-discipline-manager.app" : process.execPath);
        }
        rendererUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL
            ? new URL(process.env.ELECTRON_RENDERER_URL).href
            : new URL("../renderer/index.html", import.meta.url).href;

        initializeDatabase(
            path.join(app.getPath("userData"), "data.db"),
            path.join(app.getAppPath(), "drizzle"),
        );
        getLocalPreferences();
        const validateSender = createSenderValidator(() => mainWindow, rendererUrl);
        registerTaskIpc(validateSender);
        registerSettingsIpc(validateSender);
        await createWindow();
        if (isQuitting) return;
        createTray();
        startTaskScheduler();
        startupComplete = true;
        app.on("activate", () => {
            if (!mainWindow) void createWindow().catch(reportFatalError);
            else showMainWindow();
        });
    }).catch(reportFatalError);
}
