import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

export type SenderValidator = (event: IpcMainInvokeEvent) => void;

export function createSenderValidator(
    getWindow: () => BrowserWindow | null,
    rendererUrl: string,
): SenderValidator {
    const trustedUrl = new URL(rendererUrl);
    trustedUrl.hash = "";

    return (event) => {
        const window = getWindow();
        if (!window || window.isDestroyed() || event.sender !== window.webContents ||
            !event.senderFrame || event.senderFrame !== window.webContents.mainFrame) {
            throw new Error("Untrusted IPC sender");
        }

        let senderUrl: URL;
        try {
            senderUrl = new URL(event.senderFrame.url);
        } catch {
            throw new Error("Untrusted IPC sender");
        }
        senderUrl.hash = "";
        // File URLs share an opaque origin, so compare the exact app document too.
        if (senderUrl.href !== trustedUrl.href) {
            throw new Error("Untrusted IPC sender");
        }
    };
}
