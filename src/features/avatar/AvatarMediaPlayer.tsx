import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getCachedGifClip,
  loadGifClip,
  type DecodedGifClip,
  type DecodedGifFrame
} from "./gifPlayback";
import type { AvatarRenderModel } from "./types";

function AvatarImageFallback({
  src,
  renderKey,
  avatarAlt
}: {
  src: string;
  renderKey: string;
  avatarAlt: string;
}) {
  return (
    <img
      key={renderKey}
      src={src}
      className="avatarImg avatarImgLayer avatarImgCurrent"
      alt={avatarAlt}
      loading="eager"
      decoding="sync"
      draggable={false}
    />
  );
}

const AvatarGifCanvas = memo(function AvatarGifCanvas({
  renderModel,
  avatarAlt
}: {
  renderModel: NonNullable<AvatarRenderModel>;
  avatarAlt: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const tempCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [clip, setClip] = useState<DecodedGifClip | null>(() => getCachedGifClip(renderModel.src));
  const [decodeFailed, setDecodeFailed] = useState(false);
  const playbackRateRef = useRef(renderModel.playbackRate);
  const loopModeRef = useRef(renderModel.loopMode);

  useEffect(() => {
    playbackRateRef.current = renderModel.playbackRate;
  }, [renderModel.playbackRate]);

  useEffect(() => {
    loopModeRef.current = renderModel.loopMode;
  }, [renderModel.loopMode]);

  useEffect(() => {
    let cancelled = false;
    setDecodeFailed(false);
    setClip(getCachedGifClip(renderModel.src));

    loadGifClip(renderModel.src)
      .then((decodedClip) => {
        if (!cancelled) {
          setClip(decodedClip);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDecodeFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [renderModel.key, renderModel.src]);

  useLayoutEffect(() => {
    if (!clip || decodeFailed) {
      return;
    }
    const decodedClip = clip;

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      return;
    }
    const context = ctx;

    const tempCanvas = tempCanvasRef.current ?? document.createElement("canvas");
    tempCanvasRef.current = tempCanvas;
    const tempCtx = tempCanvas.getContext("2d", { alpha: true });
    if (!tempCtx) {
      return;
    }
    const patchContext = tempCtx;

    canvas.width = decodedClip.width;
    canvas.height = decodedClip.height;
    context.clearRect(0, 0, decodedClip.width, decodedClip.height);

    let cancelled = false;
    let frameIndex = 0;
    let timerId: number | null = null;
    let previousFrame: DecodedGifFrame | null = null;
    let restoreSnapshot: ImageData | null = null;

    function clearFrameArea(frame: DecodedGifFrame) {
      context.clearRect(frame.dims.left, frame.dims.top, frame.dims.width, frame.dims.height);
    }

    function applyPreviousFrameDisposal() {
      if (!previousFrame) {
        return;
      }

      if (previousFrame.disposalType === 2) {
        clearFrameArea(previousFrame);
      } else if (previousFrame.disposalType === 3 && restoreSnapshot) {
        context.putImageData(restoreSnapshot, 0, 0);
      }

      restoreSnapshot = null;
    }

    function drawFrame(frame: DecodedGifFrame) {
      applyPreviousFrameDisposal();

      if (frame.disposalType === 3) {
        restoreSnapshot = context.getImageData(0, 0, decodedClip.width, decodedClip.height);
      }

      tempCanvas.width = frame.dims.width;
      tempCanvas.height = frame.dims.height;
      patchContext.clearRect(0, 0, frame.dims.width, frame.dims.height);
      patchContext.putImageData(frame.patch, 0, 0);
      context.drawImage(tempCanvas, frame.dims.left, frame.dims.top);
      previousFrame = frame;
    }

    function scheduleNext(nextDelayMs: number, cb: () => void) {
      timerId = window.setTimeout(cb, Math.max(0, nextDelayMs));
    }

    function playCurrentFrame() {
      if (cancelled) {
        return;
      }

      const frame = decodedClip.frames[frameIndex];
      drawFrame(frame);

      const isLastFrame = frameIndex >= decodedClip.frames.length - 1;
      if (isLastFrame && loopModeRef.current === "once") {
        timerId = null;
        return;
      }

      frameIndex = isLastFrame ? 0 : frameIndex + 1;
      const playbackRate = Math.max(0.1, playbackRateRef.current || 1);
      scheduleNext(frame.delayMs / playbackRate, playCurrentFrame);
    }

    playCurrentFrame();

    return () => {
      cancelled = true;
      if (timerId !== null) {
        window.clearTimeout(timerId);
      }
    };
  }, [clip, decodeFailed, renderModel.key]);

  if (decodeFailed) {
    return <AvatarImageFallback src={renderModel.src} renderKey={renderModel.key} avatarAlt={avatarAlt} />;
  }

  return (
    <canvas
      ref={canvasRef}
      className="avatarImg avatarImgLayer avatarImgCurrent"
      role="img"
      aria-label={avatarAlt}
    />
  );
});

const AvatarVideoPlayer = memo(function AvatarVideoPlayer({
  renderModel,
  avatarAlt
}: {
  renderModel: NonNullable<AvatarRenderModel>;
  avatarAlt: string;
}) {
  return (
    <video
      key={renderModel.key}
      className="avatarImg avatarImgLayer avatarImgCurrent"
      src={renderModel.src}
      autoPlay
      muted
      playsInline
      loop={renderModel.loopMode === "repeat"}
      aria-label={avatarAlt}
    />
  );
});

export const AvatarMediaPlayer = memo(function AvatarMediaPlayer({
  renderModel,
  avatarAlt,
  avatarFallback
}: {
  renderModel: AvatarRenderModel;
  avatarAlt: string;
  avatarFallback: string;
}) {
  if (!renderModel) {
    return <div className="avatarFallback">{avatarFallback}</div>;
  }

  if (renderModel.mediaKind === "video") {
    return <AvatarVideoPlayer renderModel={renderModel} avatarAlt={avatarAlt} />;
  }

  return <AvatarGifCanvas key={renderModel.key} renderModel={renderModel} avatarAlt={avatarAlt} />;
});
