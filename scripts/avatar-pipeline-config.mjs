export const AVATAR_FPS = 24;
export const AVATAR_LOOP_FPS = AVATAR_FPS;
export const AVATAR_TRANSITION_FPS = AVATAR_FPS;

const TRANSITION_FPS_OVERRIDES = {
  tr_thinking_process_to_speaking_explain: 36
};

export function getLoopTargetFps(_assetId) {
  return AVATAR_LOOP_FPS;
}

export function getTransitionTargetFps(assetId) {
  return TRANSITION_FPS_OVERRIDES[assetId] ?? AVATAR_TRANSITION_FPS;
}
