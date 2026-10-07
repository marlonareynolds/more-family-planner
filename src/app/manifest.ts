import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "More",
    short_name: "More",
    description: "More room for me. More time for us. Better days together.",
    start_url: "/today",
    display: "standalone",
    background_color: "#f3eee4",
    theme_color: "#23345c",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    // Long-press the home-screen icon. Plain words only: anyone can see these.
    shortcuts: [
      { name: "Today", url: "/today", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "This week", url: "/week", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "Jobs", url: "/jobs", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
    ],
  };
}
