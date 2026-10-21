import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

/**
 * Social preview tags need absolute URLs. index.html writes %SITE_URL%; it becomes VITE_SITE_URL, or the
 * production URL Vercel provides during its builds. With neither, the tags that use it are left out.
 */
const siteUrl = (): Plugin => {
  let url = "";
  return {
    name: "smart-sac-site-url",
    configResolved(config) {
      const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
      url = (config.env.VITE_SITE_URL || (vercel ? `https://${vercel}` : "")).replace(/\/$/, "");
    },
    transformIndexHtml(html) {
      return url ? html.replaceAll("%SITE_URL%", url) : html.replace(/^[ \t]*<meta[^>]*%SITE_URL%[^>]*>\r?\n/gm, "");
    },
  };
};

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  plugins: [react(), siteUrl()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: app deploys don't invalidate the cached libraries
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          radix: [
            "@radix-ui/react-dialog",
            "@radix-ui/react-alert-dialog",
            "@radix-ui/react-popover",
            "@radix-ui/react-select",
            "@radix-ui/react-tabs",
            "@radix-ui/react-tooltip",
          ],
          charts: ["recharts"],
        },
      },
    },
  },
});
