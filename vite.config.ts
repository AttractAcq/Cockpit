import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  base: "/Cockpit/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // Fail loudly rather than drifting to another port. With strictPort:false
    // Vite silently moves to the next free port when 5173 is taken, so a
    // bookmarked http://localhost:5173 quietly serves whatever other project
    // claimed it first — which reads as "all my client data disappeared"
    // rather than as a port conflict. Refusing to start makes the real cause
    // obvious immediately.
    strictPort: true,
  },
});
