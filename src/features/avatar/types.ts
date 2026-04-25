export type AnchorState =
  | "idle_neutral"
  | "warm_friendly"
  | "listening_attentive"
  | "thinking_process"
  | "speaking_explain"
  | "positive_happy";

export type PlaybackKind = "idle" | "loop" | "transition";
export type PlayDirection = "forward" | "reverse";
export type LoopMode = "once" | "repeat";

export type ClipAsset = {
  id: string;
  kind: "loop" | "transition";
  state?: AnchorState;
  from?: AnchorState;
  to?: AnchorState;
  src: string;
  reverseSrc?: string;
  durationMs: number;
  format: "gif" | "webm";
};

export type AvatarManifest = {
  loops: Record<AnchorState, ClipAsset[]>;
  transitions: Record<string, ClipAsset>;
};

export type TransitionLeg = {
  from: AnchorState;
  to: AnchorState;
  asset: ClipAsset;
  direction: PlayDirection;
};

export type RoutePlan =
  | { kind: "same_state" }
  | { kind: "transition_plan"; legs: TransitionLeg[] }
  | { kind: "direct_switch"; target: AnchorState };

export type AvatarRenderModel =
  | {
      mediaKind: "gif" | "video";
      src: string;
      key: string;
      assetId: string;
      playbackKind: PlaybackKind;
      playDirection: PlayDirection;
      loopMode: LoopMode;
      playbackRate: number;
    }
  | null;

export type AvatarRuntime = {
  currentState: AnchorState;
  targetState: AnchorState | null;
  isTransitioning: boolean;
  playbackKind: PlaybackKind;
  playDirection: PlayDirection;
  currentLoopAsset: ClipAsset | null;
  currentTransitionAsset: ClipAsset | null;
  pendingState: AnchorState | null;
  renderModel: AvatarRenderModel;
  recentLoopsByState: Partial<Record<AnchorState, string[]>>;
  autoSettleTo: AnchorState | null;
  remainingLoopsBeforeAutoSettle: number | null;
  lastRouteDescription: string;
};
