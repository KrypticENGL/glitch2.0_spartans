import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "SURAKSHA",
    short_name: "SURAKSHA",
    description: "Intelligent Flood Evacuation & Rescue Coordination",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any", // maps are used in both orientations on phones and tablets
    theme_color: "#1B3034",
    background_color: "#F2F5F4",
    lang: "en-IN",
    categories: ["utilities", "navigation"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Emergency help", url: "/sos", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Alerts", url: "/alerts", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
