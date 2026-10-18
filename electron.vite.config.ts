import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
    main: {
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "electron/main.ts")
                }
            }
        }
    },

    preload: {
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "electron/preload.ts")
                }
            }
        }
    },

    renderer: {
        root: ".",

        plugins: [
            {
                name: "development-csp",
                apply: "serve",
                transformIndexHtml(html) {
                    return html
                        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
                        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
                        .replace("connect-src 'self'", "connect-src 'self' ws: wss:");
                },
            },
            react()
        ],

        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "index.html")
                }
            }
        }
    }
});
