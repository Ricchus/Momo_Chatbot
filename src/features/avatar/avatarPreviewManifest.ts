import { AVATAR_LOCAL_CONFIG } from "../../config/avatar.local";
import manifest from "./avatarManifest.generated";
import type { AvatarManifest, ClipAsset } from "./types";

const previewLoopModules = import.meta.glob(
  "/tmp/avatar-background-match-preview/public/avatar/loops/**/*.gif",
  {
    eager: true,
    import: "default"
  }
) as Record<string, string>;

const previewTransitionModules = import.meta.glob(
  "/tmp/avatar-background-match-preview/public/avatar/transitions/*.gif",
  {
    eager: true,
    import: "default"
  }
) as Record<string, string>;

const previewReverseModules = import.meta.glob(
  "/tmp/avatar-background-match-preview/public/avatar/transitions_reverse/*.gif",
  {
    eager: true,
    import: "default"
  }
) as Record<string, string>;

function getPreviewLoopSrc(src: string) {
  return previewLoopModules[`/tmp/avatar-background-match-preview/public${src}`];
}

function getPreviewTransitionSrc(src: string) {
  return previewTransitionModules[`/tmp/avatar-background-match-preview/public${src}`];
}

function getPreviewReverseSrc(assetId: string) {
  return previewReverseModules[
    `/tmp/avatar-background-match-preview/public/avatar/transitions_reverse/${assetId}__rev.gif`
  ];
}

function overrideLoopAsset(asset: ClipAsset) {
  const previewSrc = getPreviewLoopSrc(asset.src);
  if (!previewSrc) {
    return asset;
  }

  return {
    ...asset,
    src: previewSrc
  };
}

function overrideTransitionAsset(asset: ClipAsset) {
  const previewSrc = getPreviewTransitionSrc(asset.src);
  const previewReverseSrc = asset.reverseSrc ? getPreviewReverseSrc(asset.id) : undefined;

  if (!previewSrc && !previewReverseSrc) {
    return asset;
  }

  return {
    ...asset,
    src: previewSrc ?? asset.src,
    reverseSrc: previewReverseSrc ?? asset.reverseSrc
  };
}

function createPreviewManifest(baseManifest: AvatarManifest): AvatarManifest {
  if (!AVATAR_LOCAL_CONFIG.useBackgroundMatchPreview) {
    return baseManifest;
  }

  const loops = Object.fromEntries(
    Object.entries(baseManifest.loops).map(([state, assets]) => [
      state,
      assets.map(overrideLoopAsset)
    ])
  ) as AvatarManifest["loops"];

  const transitions = Object.fromEntries(
    Object.entries(baseManifest.transitions).map(([transitionId, asset]) => [
      transitionId,
      overrideTransitionAsset(asset)
    ])
  );

  return {
    loops,
    transitions
  };
}

const previewManifest = createPreviewManifest(manifest);

export default previewManifest;
