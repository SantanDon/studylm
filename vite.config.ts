import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import net from "net";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const explicit = env.VITE_API_PORT || env.PORT || "3001";

  // Probe candidate ports; if backend isn't on `explicit`, fall back to the
  // first listening port among 3001, 4000, 4001, 4002. This prevents the
  // "frontend can't reach backend" failure when 3001 is in TIME_WAIT.
  async function resolveBackendPort() {
    const candidates = [explicit, "3001", "4000", "4001", "4002"].filter(
      (v, i, a) => a.indexOf(v) === i
    );
    for (const port of candidates) {
      if (await isPortListening(parseInt(port, 10))) return port;
    }
    return explicit; // let it fail loudly with the explicit choice
  }

  function isPortListening(port) {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(250);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.connect(port, "127.0.0.1");
    });
  }

  return {
    plugins: [
      {
        name: "backend-port-probe",
        async configResolved() {
          const port = await resolveBackendPort();
          if (port !== explicit) {
            console.log(`\n[vite] Backend not on ${explicit}; using ${port} for /api proxy.\n` +
              `  Set VITE_API_PORT=${port} to silence this. Backend log line should show\n` +
              `  "StudyPod Phoenix running on http://127.0.0.1:${port}".\n`);
          }
        },
      },
      react(),
    ],
  esbuild: {
    pure: mode === "production" ? ["console.log", "console.debug"] : [],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${explicit}`,
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error(`\n[vite proxy] /api → http://127.0.0.1:${explicit} failed: ${err.code}\n` +
              `  Is the backend running? Check the backend log for "StudyPod Phoenix running on http://127.0.0.1:PORT".\n` +
              `  Set VITE_API_PORT=<port> in your .env if backend is on a different port.\n`);
          });
        },
      }
    },
    // Cross-Origin Isolation headers for SharedArrayBuffer (required for Web Workers with ONNX)
    // Using 'credentialless' instead of 'require-corp' to allow loading external resources (ONNX models)
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
    optimizeDeps: {
    include: ['pdfjs-dist', '@mozilla/readability'],
  },
  worker: {
    format: 'es',
  },
  build: {
    sourcemap: false,
  }
  };
});

