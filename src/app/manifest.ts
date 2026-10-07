import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "More",
    short_name: "More",
    description: "More room for me. More time for us. Better days together.",
    start_url: "/today",
    display: "standalone",
    background_color: "#faf7f2",
    theme_color: "#2f5d50",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
