import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { compression } from "vite-plugin-compression2";
import path from "path";
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { serviceWorkerPlugin } from "./vite-plugin-service-worker";

// Plugin to exclude test files from build
const excludeTestFiles = (): Plugin => {
  const isTestFile = (id: string): boolean => {
    return (
      id.includes("/__tests__/") ||
      id.includes(".test.") ||
      id.includes("/test-utils/") ||
      id.includes("/test/")
    );
  };

  return {
    name: "exclude-test-files",
    resolveId(id) {
      // Exclude test files and test utilities from build
      if (isTestFile(id)) {
        // Return empty module to exclude from build
        return { id: "\0excluded:" + id, moduleSideEffects: false };
      }
      return null;
    },
    load(id) {
      // Return empty module for excluded test files
      if (id.startsWith("\0excluded:")) {
        return "export {}";
      }
      return null;
    },
  };
};

const isServerResponse = (value: unknown): value is ServerResponse => {
  return (
    typeof value === "object" &&
    value !== null &&
    "headersSent" in value &&
    "writeHead" in value &&
    "end" in value
  );
};

export default defineConfig(({ mode }) => {
  // Load env from root directory (parent of apps/web)
  const env = loadEnv(mode, path.resolve(__dirname, "../.."), "");

  // Use the config() hook so manualChunks merges through mergeConfig's rollupOptions path,
  // which correctly propagates to each environment in Vite 8. Direct rolldownOptions.output
  // assignment is lost during environment config resolution (Vite 8.0.x bug).
  const chunkSplittingPlugin: Plugin = {
    name: "chunk-splitting",
    config(_config, { command }) {
      if (command !== "build") return;
      return {
        build: {
          rollupOptions: {
            output: {
              manualChunks(id: string) {
                if (/node_modules\/(react|react-dom|scheduler)(\/|$)/.test(id))
                  return "react";
                if (/node_modules\/@tanstack\/react-router(\/|$)/.test(id))
                  return "router";
                if (/node_modules\/@tanstack\/react-query(\/|$)/.test(id))
                  return "query";
                if (/node_modules\/lucide-react(\/|$)/.test(id)) return "icons";
                if (/node_modules\/@tiptap(\/|$)/.test(id)) return "tiptap";
                if (/node_modules\/(@headlessui|@radix-ui)(\/|$)/.test(id))
                  return "ui";
                if (/node_modules\/@dnd-kit(\/|$)/.test(id)) return "dnd";
                if (/node_modules\/react-hook-form(\/|$)/.test(id))
                  return "forms";
                if (/node_modules\/(i18next|react-i18next)(\/|$)/.test(id))
                  return "i18n";
                if (/node_modules\/lodash-es(\/|$)/.test(id)) return "lodash";
                if (
                  /node_modules\/(react-markdown|rehype-sanitize|remark|unified|hast|mdast|micromark|vfile)(\/|$)/.test(
                    id,
                  )
                )
                  return "markdown";
              },
            },
          },
        },
      };
    },
  };

  const plugins = [
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routesDirectory: "./src/pages",
      generatedRouteTree: "./src/routeTree.gen.ts",
      routeFileIgnorePattern: "^_[^_]|\\buse[A-Z]",
    }) as Plugin,
    react({ babel: { plugins: ["babel-plugin-react-compiler"] } }),
    chunkSplittingPlugin,
    excludeTestFiles(),
    serviceWorkerPlugin(),
    compression({
      algorithm: "gzip",
      exclude: [/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|eot|map)$/i],
    }),
  ];
  const apiPort = env.API_PORT || "5001";
  const apiHost = env.API_HOST || `http://localhost:${apiPort}`;
  console.log(`Using API host: ${apiHost}`);

  return {
    plugins,
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        "/api": {
          target: apiHost,
          changeOrigin: true,
          secure: false,
          configure: (proxy, _options) => {
            proxy.on("error", (err: NodeJS.ErrnoException, _req, res) => {
              // Only log non-connection errors (backend may not be running)
              if (err.code !== "ECONNREFUSED" && err.code !== "ENOTFOUND") {
                console.error("Proxy error:", err);
              }
              // Return a proper error response if response object is available
              if (isServerResponse(res) && !res.headersSent) {
                res.writeHead(502, {
                  "Content-Type": "application/json",
                });
                res.end(
                  JSON.stringify({
                    error: `Backend server is not available. Please ensure the backend is running on ${apiHost}`,
                    message: "To start the backend, run: docker compose up",
                  }),
                );
              }
            });
            proxy.on("proxyReq", (proxyReq) => {
              // Handle connection errors more gracefully
              proxyReq.on("error", (err: NodeJS.ErrnoException) => {
                if (err.code === "ECONNREFUSED" || err.code === "ENOTFOUND") {
                  // Silently handle connection refused errors (backend not running)
                  return;
                }
              });
            });
          },
        },
      },
    },
    test: {
      globals: true,
      environment: "happy-dom",
      setupFiles: ["./src/test/setup.ts"],
      exclude: ["e2e/**", "node_modules/**"],
      poolOptions: {
        forks: {
          execArgv: ["--max-old-space-size=1024"],
        },
      },
    },
  };
});
