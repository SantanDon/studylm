import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import net from "net";

// https://vitejs.dev/config/
export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const explicit =
    process.env.VITE_API_PORT ||
    env.VITE_API_PORT ||
    process.env.PORT ||
    env.PORT ||
    "3001";

  function isPortListening(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(250);
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
      socket.connect(port, "127.0.0.1");
    });
  }

  async function resolveBackendPort(): Promise<string> {
    const candidates = [explicit, "3001", "4000", "4001", "4002"].filter(
      (value, index, all) => all.indexOf(value) === index,
    );

    for (const port of candidates) {
      if (await isPortListening(Number.parseInt(port, 10))) return port;
    }

    return explicit;
  }

  const backendPort = await resolveBackendPort();
  if (backendPort !== explicit) {
    console.log(
      `\n[vite] Backend not on ${explicit}; using ${backendPort} for /api proxy.\n` +
        `  Set VITE_API_PORT=${backendPort} to silence this.\n`,
    );
  }

  const backendTarget = `http://127.0.0.1:${backendPort}`;

  return {
    plugins: [react()],
    esbuild: {
      pure: mode === "production" ? ["console.log", "console.debug"] : [],
    },
    server: {
      host: "127.0.0.1",
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
          configure: (proxy) => {
            proxy.on("error", (error) => {
              console.error(
                `\n[vite proxy] /api → ${backendTarget} failed: ${error.code}\n` +
                  `  Is the backend running? Check the backend log for ` +
                  `"StudyPod Phoenix running on http://127.0.0.1:PORT".\n`,
              );
            });
          },
        },
      },
      // Cross-Origin Isolation headers for SharedArrayBuffer (required for Web Workers with ONNX)
      // Using 'credentialless' instead of 'require-corp' to allow loading external resources (ONNX models)
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      },
    },
    preview: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
      },
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    optimizeDeps: {
      include: ["pdfjs-dist", "@mozilla/readability"],
    },
    worker: {
      format: "es",
    },
    build: {
      sourcemap: false,
    },
  };
});
