import { STATE_BEHAVIOR } from "./avatarConfig";
import { LoopScheduler } from "./loopScheduler";
import { RoutePlanner } from "./routePlanner";
import type {
  AnchorState,
  AvatarManifest,
  AvatarRenderModel,
  AvatarRuntime,
  ClipAsset,
  LoopMode,
  PlayDirection,
  TransitionLeg
} from "./types";

type StateRequestOptions = {
  shouldHold?: boolean;
  isActiveTrigger?: boolean;
};

type CreateAvatarControllerArgs = {
  manifest: AvatarManifest;
  onRuntimeChange: (runtime: AvatarRuntime) => void;
};

export type AvatarController = ReturnType<typeof createAvatarController>;

const NON_HOLDABLE_STATES = new Set<AnchorState>(["speaking_explain"]);
const ACTIVE_TRIGGER_PLAYBACK_RATE = 2;

type PendingStateRequest = {
  state: AnchorState;
  options?: StateRequestOptions;
};

type PlaybackTimer = {
  durationMs: number;
  startedAt: number;
  playbackRate: number;
  callback: () => void;
};

function shouldLetGifSelfLoop(state: AnchorState, options?: StateRequestOptions) {
  return !NON_HOLDABLE_STATES.has(state) && (options?.shouldHold ?? false);
}

function makeRenderModel(
  asset: ClipAsset,
  direction: PlayDirection,
  playbackKind: "loop" | "transition",
  token: number,
  loopMode: LoopMode,
  playbackRate: number
): AvatarRenderModel {
  const sourcePath = direction === "reverse" && asset.reverseSrc ? asset.reverseSrc : asset.src;
  return {
    mediaKind: asset.format === "webm" ? "video" : "gif",
    src: sourcePath,
    key: `${asset.id}-${direction}-${token}`,
    assetId: asset.id,
    playbackKind,
    playDirection: direction,
    loopMode,
    playbackRate
  };
}

export function createAvatarController({ manifest, onRuntimeChange }: CreateAvatarControllerArgs) {
  const loopScheduler = new LoopScheduler(manifest);
  const routePlanner = new RoutePlanner(manifest);

  const runtime: AvatarRuntime = {
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
    lastRouteDescription: "初始待机"
  };

  let playbackToken = 0;
  let timer: number | null = null;
  let timerState: PlaybackTimer | null = null;
  let pendingRequest: PendingStateRequest | null = null;
  let acceleratedTarget: AnchorState | null = null;

  function emit() {
    onRuntimeChange({ ...runtime, recentLoopsByState: { ...runtime.recentLoopsByState } });
  }

  function stopTimer() {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
    timerState = null;
  }

  function getPlaybackRate() {
    return acceleratedTarget ? ACTIVE_TRIGGER_PLAYBACK_RATE : 1;
  }

  function setTimer(ms: number, cb: () => void, playbackRate = getPlaybackRate()) {
    stopTimer();
    const durationMs = Math.max(0, ms);
    timerState = {
      durationMs,
      startedAt: performance.now(),
      playbackRate,
      callback: cb
    };
    timer = window.setTimeout(() => {
      timer = null;
      timerState = null;
      cb();
    }, durationMs / playbackRate);
  }

  function rescheduleTimer(nextPlaybackRate: number) {
    if (!timerState) {
      return;
    }

    const elapsedMs = performance.now() - timerState.startedAt;
    const consumedClipMs = elapsedMs * timerState.playbackRate;
    const remainingClipMs = Math.max(0, timerState.durationMs - consumedClipMs);
    const callback = timerState.callback;
    setTimer(remainingClipMs, callback, nextPlaybackRate);
  }

  function syncCurrentPlaybackRate() {
    const nextPlaybackRate = getPlaybackRate();
    let shouldEmit = false;

    if (runtime.renderModel && runtime.renderModel.playbackRate !== nextPlaybackRate) {
      runtime.renderModel = {
        ...runtime.renderModel,
        playbackRate: nextPlaybackRate
      };
      shouldEmit = true;
    }

    if (timerState && timerState.playbackRate !== nextPlaybackRate) {
      rescheduleTimer(nextPlaybackRate);
    }

    if (shouldEmit) {
      emit();
    }
  }

  function setAcceleratedTarget(nextTarget: AnchorState | null) {
    if (acceleratedTarget === nextTarget) {
      return;
    }

    acceleratedTarget = nextTarget;
    syncCurrentPlaybackRate();
  }

  function clearPendingRequest() {
    pendingRequest = null;
    runtime.pendingState = null;
  }

  function setPendingRequest(state: AnchorState, options?: StateRequestOptions) {
    pendingRequest = { state, options };
    runtime.pendingState = state;
    runtime.targetState = state;
  }

  function takePendingRequest() {
    const request = pendingRequest;
    clearPendingRequest();
    return request;
  }

  function shouldQueueUntilCurrentLoopEnds(nextState: AnchorState, options?: StateRequestOptions) {
    if (!options?.isActiveTrigger || runtime.playbackKind !== "loop" || runtime.currentState === nextState) {
      return false;
    }

    return (
      runtime.autoSettleTo !== null &&
      runtime.remainingLoopsBeforeAutoSettle !== null &&
      runtime.remainingLoopsBeforeAutoSettle <= 1
    );
  }

  function applyLoopBehavior(state: AnchorState, options?: StateRequestOptions) {
    const behavior = STATE_BEHAVIOR[state];
    const shouldHold = NON_HOLDABLE_STATES.has(state) ? false : (options?.shouldHold ?? false);
    runtime.autoSettleTo = shouldHold ? null : behavior.autoSettleTo;
    runtime.remainingLoopsBeforeAutoSettle = shouldHold ? null : behavior.loopsBeforeAutoSettle;
  }

  function enterLoop(state: AnchorState, options?: StateRequestOptions) {
    if (acceleratedTarget === state) {
      acceleratedTarget = null;
    }

    const shouldSelfLoop = shouldLetGifSelfLoop(state, options);
    const previousPlaybackKind = runtime.playbackKind;
    runtime.currentState = state;
    runtime.targetState = state;
    runtime.isTransitioning = false;
    runtime.currentTransitionAsset = null;
    runtime.playbackKind = "loop";
    runtime.playDirection = "forward";
    runtime.pendingState = pendingRequest?.state ?? null;
    applyLoopBehavior(state, options);

    const recentIds = runtime.recentLoopsByState[state] ?? [];
    const asset = loopScheduler.pickNext(state, recentIds);
    const shouldReuseCurrentLoop =
      shouldSelfLoop &&
      state === "idle_neutral" &&
      previousPlaybackKind === "loop" &&
      runtime.currentLoopAsset?.id === asset.id &&
      runtime.renderModel !== null;
    runtime.currentLoopAsset = asset;
    if (!shouldReuseCurrentLoop) {
      playbackToken += 1;
      runtime.renderModel = makeRenderModel(
        asset,
        "forward",
        "loop",
        playbackToken,
        shouldSelfLoop ? "repeat" : "once",
        getPlaybackRate()
      );
    }
    loopScheduler.recordPlayed(runtime.recentLoopsByState, state, asset.id);

    emit();

    if (shouldLetGifSelfLoop(state, options)) {
      stopTimer();
      return;
    }

    setTimer(asset.durationMs, () => {
      if (runtime.currentState !== state || runtime.isTransitioning) return;

      if (
        runtime.autoSettleTo &&
        runtime.remainingLoopsBeforeAutoSettle !== null &&
        runtime.remainingLoopsBeforeAutoSettle <= 1 &&
        pendingRequest &&
        pendingRequest.state !== state
      ) {
        const pending = takePendingRequest();
        if (pending) {
          requestState(pending.state, pending.options);
          return;
        }
      }

      if (
        runtime.autoSettleTo &&
        runtime.remainingLoopsBeforeAutoSettle !== null &&
        runtime.remainingLoopsBeforeAutoSettle <= 1
      ) {
        requestState(runtime.autoSettleTo);
        return;
      }

      if (runtime.remainingLoopsBeforeAutoSettle !== null) {
        runtime.remainingLoopsBeforeAutoSettle -= 1;
      }

      enterLoop(state, options);
    });
  }

  function finishAfterTransitions(finalTarget: AnchorState, options?: StateRequestOptions) {
    runtime.isTransitioning = false;
    runtime.currentState = finalTarget;
    runtime.targetState = finalTarget;
    runtime.currentTransitionAsset = null;
    runtime.pendingState = pendingRequest?.state ?? null;

    if (pendingRequest) {
      const pending = takePendingRequest();
      if (pending && pending.state !== finalTarget) {
        requestState(pending.state, pending.options);
        return;
      }
      if (pending?.state === finalTarget) {
        options = pending.options ?? options;
      }
    }

    enterLoop(finalTarget, options);
  }

  function playTransitionLegs(legs: TransitionLeg[], finalTarget: AnchorState, options?: StateRequestOptions) {
    const [first, ...rest] = legs;
    if (!first) {
      finishAfterTransitions(finalTarget, options);
      return;
    }

    runtime.isTransitioning = true;
    runtime.playbackKind = "transition";
    runtime.playDirection = first.direction;
    runtime.currentTransitionAsset = first.asset;
    runtime.currentLoopAsset = null;
    runtime.pendingState = pendingRequest?.state ?? null;
    playbackToken += 1;
    runtime.renderModel = makeRenderModel(
      first.asset,
      first.direction,
      "transition",
      playbackToken,
      "once",
      getPlaybackRate()
    );
    emit();

    setTimer(first.asset.durationMs, () => {
      if (rest.length > 0) {
        playTransitionLegs(rest, finalTarget, options);
      } else {
        finishAfterTransitions(finalTarget, options);
      }
    });
  }

  function requestState(nextState: AnchorState, options?: StateRequestOptions) {
    if (options?.isActiveTrigger) {
      if (runtime.currentState === nextState && !runtime.isTransitioning) {
        setAcceleratedTarget(null);
      } else {
        setAcceleratedTarget(nextState);
      }
    }

    if (runtime.isTransitioning || shouldQueueUntilCurrentLoopEnds(nextState, options)) {
      if (pendingRequest?.state === nextState) {
        return;
      }
      setPendingRequest(nextState, options);
      runtime.lastRouteDescription = `${runtime.currentState} -> ${nextState}（等待当前播放结束）`;
      emit();
      return;
    }

    if (runtime.currentState === nextState) {
      clearPendingRequest();
      runtime.lastRouteDescription = `保持 ${nextState}`;
      runtime.targetState = nextState;

      if (runtime.playbackKind === "loop" && runtime.currentLoopAsset) {
        applyLoopBehavior(nextState, options);
        const shouldSelfLoop = shouldLetGifSelfLoop(nextState, options);
        const nextLoopMode = shouldSelfLoop ? "repeat" : "once";
        const nextPlaybackRate = getPlaybackRate();

        if (!shouldSelfLoop && timer === null) {
          enterLoop(nextState, options);
          return;
        }

        if (
          !runtime.renderModel ||
          runtime.renderModel.loopMode !== nextLoopMode ||
          runtime.renderModel.playbackRate !== nextPlaybackRate
        ) {
          runtime.renderModel = runtime.renderModel
            ? {
                ...runtime.renderModel,
                loopMode: nextLoopMode,
                playbackRate: nextPlaybackRate
              }
            : runtime.renderModel;
        }

        if (shouldSelfLoop) {
          stopTimer();
        }
        emit();
        return;
      }

      stopTimer();
      enterLoop(nextState, options);
      return;
    }

    stopTimer();

    const plan = routePlanner.plan(runtime.currentState, nextState);
    if (plan.kind === "same_state") {
      runtime.lastRouteDescription = `保持 ${nextState}`;
      enterLoop(nextState, options);
      return;
    }

    if (plan.kind === "direct_switch") {
      runtime.lastRouteDescription = `${runtime.currentState} -> ${nextState}（无合适过渡，直接切 loop）`;
      enterLoop(nextState, options);
      return;
    }

    runtime.lastRouteDescription = plan.legs
      .map((leg) => `${leg.from} -> ${leg.to}${leg.direction === "reverse" ? "（倒放）" : ""}`)
      .join(" -> ");
    playTransitionLegs(plan.legs, nextState, options);
  }

  function boot() {
    requestState("warm_friendly", { shouldHold: false });
  }

  function reset() {
    stopTimer();
    runtime.currentState = "idle_neutral";
    runtime.targetState = "idle_neutral";
    runtime.isTransitioning = false;
    runtime.playbackKind = "idle";
    runtime.playDirection = "forward";
    runtime.currentLoopAsset = null;
    runtime.currentTransitionAsset = null;
    runtime.pendingState = null;
    runtime.renderModel = null;
    runtime.autoSettleTo = null;
    runtime.remainingLoopsBeforeAutoSettle = null;
    runtime.lastRouteDescription = "重置到初始待机";
    pendingRequest = null;
    acceleratedTarget = null;
    emit();
    enterLoop("idle_neutral");
  }

  function dispose() {
    stopTimer();
  }

  return {
    runtime,
    requestState,
    boot,
    reset,
    dispose
  };
}
