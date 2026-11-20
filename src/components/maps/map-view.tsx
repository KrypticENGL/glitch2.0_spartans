"use client";

import dynamic from "next/dynamic";
import { MapPinned } from "lucide-react";

// MapLibre touches window/WebGL, so it is loaded only in the browser.
export const MapView = dynamic(() => import("./suraksha-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#dfe6ec]" role="status">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPinned className="size-4 animate-pulse" aria-hidden /> Loading 3D map…
      </span>
    </div>
  ),
});
