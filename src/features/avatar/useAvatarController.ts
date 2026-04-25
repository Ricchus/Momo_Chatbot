import { useEffect, useMemo, useState } from "react";
import { createAvatarController } from "./avatarController";
import manifest from "./avatarPreviewManifest";
import type { AvatarRuntime } from "./types";

export function useAvatarController() {
  const [runtime, setRuntime] = useState<AvatarRuntime>({
    currentState: "idle_neutral",
    targetState: "idle_neutral",
    isTransitioning: false,
    playbackKind: "idle",
    playDirection: "forward",
    currentLoopAsset: null,
    currentTransitionAsset: null,
    pendingState: null,
    renderModel: null,
    recentLoopsByState: {},
    autoSettleTo: null,
    remainingLoopsBeforeAutoSettle: null,
    lastRouteDescription: "初始化中"
  });

  const controller = useMemo(() => createAvatarController({ manifest, onRuntimeChange: setRuntime }), []);

  useEffect(() => {
    controller.reset();
    const bootTimer = window.setTimeout(() => controller.boot(), 250);
    return () => {
      window.clearTimeout(bootTimer);
      controller.dispose();
    };
  }, [controller]);

  return { controller, runtime, manifest };
}
