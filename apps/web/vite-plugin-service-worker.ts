import { join } from "path";
import { build as viteBuild, type Plugin } from "vite";
import { readFile, writeFile, rm } from "fs/promises";

/**
 * Vite plugin to compile TypeScript service worker files into a single sw.js file.
 * Uses Vite's own build API (Rolldown in Vite 8) instead of esbuild directly.
 */
export function serviceWorkerPlugin(): Plugin {
  let root: string;
  let outDir: string;

  return {
    name: "service-worker-plugin",
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir || join(root, "dist");
    },
    async buildStart() {
      // This will run during dev server startup and build
    },
    async writeBundle() {
      try {
        const swEntry = join(root, "src/sw/index.ts");
        const swOutDir = join(outDir, "_sw_tmp");

        await viteBuild({
          configFile: false,
          root,
          logLevel: "silent",
          build: {
            lib: {
              entry: swEntry,
              formats: ["iife"],
              name: "sw",
              fileName: () => "sw.js",
            },
            outDir: swOutDir,
            emptyOutDir: true,
            minify: process.env.NODE_ENV === "production",
            sourcemap: process.env.NODE_ENV === "production" ? false : "inline",
            rolldownOptions: {
              output: {
                entryFileNames: "sw.js",
              },
            },
          },
        });

        // Move sw.js from temp dir to dist root
        const compiled = await readFile(join(swOutDir, "sw.js"), "utf-8");
        await writeFile(join(outDir, "sw.js"), compiled);
        // Clean up temp dir
        await rm(swOutDir, { recursive: true }).catch(() => {});

        console.log("✓ Service worker compiled successfully");
      } catch (error) {
        console.error("✗ Failed to compile service worker:", error);
        throw error;
      }
    },
    configureServer(server) {
      // During dev, compile service worker on request using Vite's build API
      server.middlewares.use(async (req, res, next) => {
        if (req.url === "/sw.js") {
          try {
            const swEntry = join(root, "src/sw/index.ts");
            const tmpDir = join(root, ".sw-dev-tmp");

            await viteBuild({
              configFile: false,
              root,
              logLevel: "silent",
              build: {
                lib: {
                  entry: swEntry,
                  formats: ["iife"],
                  name: "sw",
                  fileName: () => "sw.js",
                },
                outDir: tmpDir,
                emptyOutDir: true,
                minify: false,
                sourcemap: "inline",
              },
            });

            const output = await readFile(join(tmpDir, "sw.js"), "utf-8");
            await rm(tmpDir, { recursive: true }).catch(() => {});

            res.setHeader("Content-Type", "application/javascript");
            res.setHeader("Cache-Control", "no-cache");
            res.end(output);
          } catch (error) {
            console.error("Failed to compile service worker:", error);
            res.statusCode = 500;
            res.end(
              `console.error("Service worker compilation error: ${error}");`,
            );
          }
        } else {
          next();
        }
      });
    },
  };
}
