import { defineConfig } from "vite";
import base from "./community-preview.config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  ...base,
  publicDir: fileURLToPath(new URL("../public", import.meta.url)),
});
