import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export const TTV_IMAGE_SERVICE = "cloudflare-binding";

export default defineConfig({
  // Canonical origin. Certificates print their own verification URL, which must
  // name the public domain rather than whichever host served the request.
  site: "https://tembotechventures.com",
  // Keep runtime image processing on Cloudflare Images. In particular, do not
  // expose Astro's Sharp service while Astro 6 remains below the AVIF fixes in
  // Astro 7.2.8 / Sharp 0.35.4.
  adapter: cloudflare({ imageService: TTV_IMAGE_SERVICE }),
  integrations: [react()],
  output: "server",
  vite: {
    plugins: [tailwindcss()],
  },
});
