import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useChatSession } from "./features/chat/useChatSession";
import { AvatarMediaPlayer } from "./features/avatar/AvatarMediaPlayer";
import { useAvatarController } from "./features/avatar/useAvatarController";
import { STATE_LABELS } from "./features/avatar/avatarConfig";
import { loadGifClip, preloadGifClip } from "./features/avatar/gifPlayback";
import { getChatApiEndpoint } from "./features/chat/clientConfig";
import type { AssistantDirective, ChatMessage, UiLocale } from "./features/chat/types";
import type { AvatarManifest, AvatarRenderModel } from "./features/avatar/types";

const LOCALE_STORAGE_KEY = "maomao_ui_locale";
const ASSISTANT_REVEAL_CHARACTERS_PER_SECOND = 48;
const BUBBLE_TAIL_LAYOUT_SPACE = 18;
const BUBBLE_TAIL_SEAM_OVERLAP = 0;
const BUBBLE_TAIL_ROOT_MAX_DISTANCE_FROM_BOTTOM = 28;
const BUBBLE_TAIL_ROOT_LOWER_MAX_DISTANCE_FROM_BOTTOM = 12;

const STATE_LABELS_EN: Record<keyof typeof STATE_LABELS, string> = {
  idle_neutral: "Idle",
  warm_friendly: "Warm Friendly",
  listening_attentive: "Listening",
  thinking_process: "Thinking",
  speaking_explain: "Explaining",
  positive_happy: "Positive"
};

const UI_TEXT: Record<
  UiLocale,
  {
    title: string;
    subtitleIdle: string;
    subtitleLoading: string;
    devToggle: string;
    devPanelTitle: string;
    currentState: string;
    playback: string;
    direction: string;
    currentLoop: string;
    currentTransition: string;
    targetState: string;
    lastRoute: string;
    chatApi: string;
    configured: string;
    notConfigured: string;
    endpoint: string;
    model: string;
    recentError: string;
    avatarAlt: string;
    avatarFallback: string;
    inputPlaceholder: string;
    inputDisabledPlaceholder: string;
    send: string;
    thinking: string;
    unknownError: string;
    none: string;
    localeToggleLabel: string;
  }
> = {
  zh: {
    title: "帽帽",
    subtitleIdle: "陪你聊聊",
    subtitleLoading: "正在思考...",
    devToggle: "开发者 UI",
    devPanelTitle: "开发者 UI",
    currentState: "当前状态",
    playback: "当前播放",
    direction: "方向",
    currentLoop: "当前 loop",
    currentTransition: "当前 transition",
    targetState: "目标状态",
    lastRoute: "最近一次路由",
    chatApi: "Chat API",
    configured: "已配置",
    notConfigured: "不可用",
    endpoint: "接口地址",
    model: "服务端模型",
    recentError: "最近错误",
    avatarAlt: "帽帽",
    avatarFallback: "帽帽正在准备中…",
    inputPlaceholder: "给帽帽发消息...",
    inputDisabledPlaceholder: "暂时还不能发送消息",
    send: "发送",
    thinking: "思考中...",
    unknownError: "未知错误",
    none: "—",
    localeToggleLabel: "界面语言"
  },
  en: {
    title: "Momo",
    subtitleIdle: "Here to chat",
    subtitleLoading: "Thinking...",
    devToggle: "Developer UI",
    devPanelTitle: "Developer UI",
    currentState: "Current State",
    playback: "Playback",
    direction: "Direction",
    currentLoop: "Current Loop",
    currentTransition: "Current Transition",
    targetState: "Target State",
    lastRoute: "Last Route",
    chatApi: "Chat API",
    configured: "Configured",
    notConfigured: "Unavailable",
    endpoint: "Endpoint",
    model: "Server Model",
    recentError: "Recent Error",
    avatarAlt: "Momo",
    avatarFallback: "Momo is getting ready…",
    inputPlaceholder: "Message Momo...",
    inputDisabledPlaceholder: "Messaging is unavailable right now",
    send: "Send",
    thinking: "Thinking...",
    unknownError: "Unknown error",
    none: "—",
    localeToggleLabel: "Interface language"
  }
};

type MessageBlock =
  | { type: "paragraph"; lines: string[] }
  | { type: "unordered-list"; items: string[] }
  | { type: "ordered-list"; items: string[]; start: number };

type BubbleSize = {
  height: number;
  width: number;
};

type BubbleTailMetrics = {
  bottomJoinX: number;
  bottomY: number;
  joinControlX: number;
  rootReturnY: number;
  rootUpperY: number;
  rootX: number;
  tipLowerControlX: number;
  tipLowerControlY: number;
  tipUpperControlX: number;
  tipUpperControlY: number;
  tipX: number;
  tipY: number;
  topOffset: number;
  viewHeight: number;
  viewWidth: number;
};

type BubbleOutlineMetrics = {
  bodyLeftX: number;
  bodyRightX: number;
  bottomJoinX: number;
  bubbleHeight: number;
  bubbleRadius: number;
  bubbleWidth: number;
  rootLowerY: number;
  rootUpperY: number;
  tailDrop: number;
  tailWidth: number;
  tipX: number;
  tipY: number;
  viewHeight: number;
  viewWidth: number;
};

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function splitTextForReveal(text: string) {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (
      locales?: string | string[],
      options?: { granularity: "grapheme" }
    ) => { segment(input: string): Iterable<{ segment: string }> };
  }).Segmenter;

  if (Segmenter) {
    return Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => part.segment);
  }

  return Array.from(text);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createBubbleTailMetrics(bubbleWidth: number, bubbleHeight: number): BubbleTailMetrics {
  const width = Math.max(bubbleWidth, 1);
  const height = Math.max(bubbleHeight, 1);
  const tailWidth = clampNumber(Math.min(width * 0.075, height * 0.16), 12, 16);
  const tailDrop = clampNumber(height * 0.1, 6, 10);
  const bodyLeftX = tailWidth;
  const overlapWidth = clampNumber(width * 0.09, width * 0.04, width * 0.12);
  const bottomJoinX = bodyLeftX + overlapWidth;
  const rootUpperY = Math.max(height * 0.74, height - BUBBLE_TAIL_ROOT_MAX_DISTANCE_FROM_BOTTOM);
  const rootLowerY = Math.max(height * 0.9, height - BUBBLE_TAIL_ROOT_LOWER_MAX_DISTANCE_FROM_BOTTOM);
  const tipX = bodyLeftX - tailWidth * 0.92;
  const tipY = height;
  const bottomJoinControlX = bodyLeftX + clampNumber(width * 0.05, 6, 12);
  const tipUpperControlX = tipX + tailWidth * 0.26;
  const tipUpperControlY = tipY + tailDrop * 0.12;
  const tipLowerControlX = tipX + tailWidth * 0.16;
  const tipLowerControlY = tipY - tailDrop * 0.16;
  const rootReturnY = rootUpperY + (rootLowerY - rootUpperY) * 0.72;
  const translateX = BUBBLE_TAIL_LAYOUT_SPACE - bodyLeftX + BUBBLE_TAIL_SEAM_OVERLAP;
  const translateY = -rootUpperY;

  return {
    bottomJoinX: bottomJoinX + translateX,
    bottomY: height + translateY,
    joinControlX: bottomJoinControlX + translateX,
    rootReturnY: rootReturnY + translateY,
    rootUpperY: 0,
    rootX: bodyLeftX + translateX,
    tipLowerControlX: tipLowerControlX + translateX,
    tipLowerControlY: tipLowerControlY + translateY,
    tipUpperControlX: tipUpperControlX + translateX,
    tipUpperControlY: tipUpperControlY + translateY,
    tipX: tipX + translateX,
    tipY: tipY + translateY,
    topOffset: rootUpperY,
    viewHeight: tipY - rootUpperY,
    viewWidth: BUBBLE_TAIL_LAYOUT_SPACE + overlapWidth + BUBBLE_TAIL_SEAM_OVERLAP
  };
}

function createBubbleOutlineMetrics(bubbleWidth: number, bubbleHeight: number): BubbleOutlineMetrics {
  const width = Math.max(bubbleWidth, 1);
  const height = Math.max(bubbleHeight, 1);
  const bubbleRadius = Math.min(24, width / 2, height / 2);
  const tailWidth = clampNumber(Math.min(width * 0.075, height * 0.16), 12, 16);
  const tailDrop = clampNumber(height * 0.1, 6, 10);
  const overlapWidth = clampNumber(width * 0.09, width * 0.04, width * 0.12);
  const translateX = BUBBLE_TAIL_LAYOUT_SPACE - tailWidth;
  const bodyLeftX = tailWidth + translateX;
  const bodyRightX = bodyLeftX + width;
  const bottomJoinX = bodyLeftX + overlapWidth;
  const rootUpperY = Math.max(height * 0.74, height - BUBBLE_TAIL_ROOT_MAX_DISTANCE_FROM_BOTTOM);
  const rootLowerY = Math.max(height * 0.9, height - BUBBLE_TAIL_ROOT_LOWER_MAX_DISTANCE_FROM_BOTTOM);
  const tipX = bodyLeftX - tailWidth * 0.92;
  const tipY = height;

  return {
    bodyLeftX,
    bodyRightX,
    bottomJoinX,
    bubbleHeight: height,
    bubbleRadius,
    bubbleWidth: width,
    rootLowerY,
    rootUpperY,
    tailDrop,
    tailWidth,
    tipX,
    tipY,
    viewHeight: height + tailDrop,
    viewWidth: width + BUBBLE_TAIL_LAYOUT_SPACE
  };
}

function matchUnorderedListItem(line: string) {
  return line.match(/^\s*[-*•]\s+(.+)$/)?.[1]?.trim() ?? null;
}

function matchOrderedListItem(line: string) {
  const match = line.match(/^\s*(\d+)\.\s+(.+)$/);
  if (!match) {
    return null;
  }

  return {
    text: match[2].trim(),
    value: Number(match[1])
  };
}

function parseMessageText(text: string): MessageBlock[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const sourceLines = normalized.split("\n");
  const blocks: MessageBlock[] = [];
  let index = 0;

  while (index < sourceLines.length) {
    const currentLine = sourceLines[index].trim();

    if (!currentLine) {
      index += 1;
      continue;
    }

    const orderedMatch = matchOrderedListItem(currentLine);
    if (orderedMatch) {
      const items = [orderedMatch.text];
      const start = orderedMatch.value;
      index += 1;

      while (index < sourceLines.length) {
        const nextLine = sourceLines[index].trim();
        if (!nextLine) {
          let nextIndex = index + 1;
          while (nextIndex < sourceLines.length && !sourceLines[nextIndex].trim()) {
            nextIndex += 1;
          }

          if (nextIndex >= sourceLines.length) {
            index = nextIndex;
            break;
          }

          const nextOrderedMatch = matchOrderedListItem(sourceLines[nextIndex].trim());
          if (!nextOrderedMatch) {
            index = nextIndex;
            break;
          }

          items.push(nextOrderedMatch.text);
          index = nextIndex + 1;
          continue;
        }

        const nextOrderedMatch = matchOrderedListItem(nextLine);
        if (!nextOrderedMatch) {
          break;
        }

        items.push(nextOrderedMatch.text);
        index += 1;
      }

      blocks.push({ type: "ordered-list", items, start });
      continue;
    }

    const unorderedMatch = matchUnorderedListItem(currentLine);
    if (unorderedMatch) {
      const items = [unorderedMatch];
      index += 1;

      while (index < sourceLines.length) {
        const nextLine = sourceLines[index].trim();
        if (!nextLine) {
          let nextIndex = index + 1;
          while (nextIndex < sourceLines.length && !sourceLines[nextIndex].trim()) {
            nextIndex += 1;
          }

          if (nextIndex >= sourceLines.length) {
            index = nextIndex;
            break;
          }

          const nextUnorderedMatch = matchUnorderedListItem(sourceLines[nextIndex].trim());
          if (!nextUnorderedMatch) {
            index = nextIndex;
            break;
          }

          items.push(nextUnorderedMatch);
          index = nextIndex + 1;
          continue;
        }

        const nextUnorderedMatch = matchUnorderedListItem(nextLine);
        if (!nextUnorderedMatch) {
          break;
        }

        items.push(nextUnorderedMatch);
        index += 1;
      }

      blocks.push({ type: "unordered-list", items });
      continue;
    }

    const lines = [currentLine];
    index += 1;

    while (index < sourceLines.length) {
      const nextLine = sourceLines[index].trim();
      if (!nextLine || matchOrderedListItem(nextLine) || matchUnorderedListItem(nextLine)) {
        break;
      }

      lines.push(nextLine);
      index += 1;
    }

    blocks.push({ type: "paragraph", lines });
  }

  return blocks;
}

function getInitialLocale(): UiLocale {
  if (typeof window === "undefined") {
    return "zh";
  }

  return window.localStorage.getItem(LOCALE_STORAGE_KEY) === "en" ? "en" : "zh";
}

function collectAvatarSources(manifest: AvatarManifest) {
  const sources = new Set<string>();

  for (const loopAssets of Object.values(manifest.loops)) {
    for (const asset of loopAssets) {
      sources.add(asset.src);
    }
  }

  for (const asset of Object.values(manifest.transitions)) {
    sources.add(asset.src);
    if (asset.reverseSrc) {
      sources.add(asset.reverseSrc);
    }
  }

  return [...sources];
}

function usePreloadedAvatarAssets(manifest: AvatarManifest) {
  useEffect(() => {
    const sources = collectAvatarSources(manifest);
    for (const src of sources) {
      preloadGifClip(src);
    }
  }, [manifest]);
}

function useStableAvatarRenderModel(renderModel: AvatarRenderModel) {
  const [visibleModel, setVisibleModel] = useState<AvatarRenderModel>(renderModel);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!renderModel) {
      requestRef.current += 1;
      setVisibleModel(null);
      return;
    }

    const requestId = ++requestRef.current;

    const commit = () => {
      if (requestId === requestRef.current) {
        setVisibleModel(renderModel);
      }
    };

    if (renderModel.mediaKind === "gif") {
      loadGifClip(renderModel.src).then(commit, commit);
      return;
    }

    commit();
  }, [renderModel]);

  return visibleModel;
}

const AnimatedAssistantText = memo(function AnimatedAssistantText({
  text,
  animate,
  onRevealStep,
  onRevealComplete
}: {
  text: string;
  animate: boolean;
  onRevealStep?: () => void;
  onRevealComplete?: () => void;
}) {
  const segments = useMemo(() => splitTextForReveal(text), [text]);
  const [visibleCount, setVisibleCount] = useState(animate ? 0 : segments.length);
  const visibleText = useMemo(() => segments.slice(0, visibleCount).join(""), [segments, visibleCount]);
  const frameRef = useRef<number | null>(null);
  const startedAtRef = useRef<number | null>(null);
  const visibleCountRef = useRef(visibleCount);
  const revealCompletedRef = useRef(false);

  useEffect(() => {
    visibleCountRef.current = visibleCount;
  }, [visibleCount]);

  useEffect(() => {
    revealCompletedRef.current = false;
  }, [animate, segments]);

  useLayoutEffect(() => {
    if (animate && visibleCount > 0) {
      onRevealStep?.();
    }
  }, [animate, onRevealStep, visibleCount]);

  useEffect(() => {
    if (!animate || revealCompletedRef.current || visibleCount < segments.length) {
      return;
    }

    revealCompletedRef.current = true;
    onRevealComplete?.();
  }, [animate, onRevealComplete, segments.length, visibleCount]);

  useEffect(() => {
    if (!animate) {
      visibleCountRef.current = segments.length;
      setVisibleCount(segments.length);
      return;
    }

    if (segments.length === 0) {
      visibleCountRef.current = 0;
      setVisibleCount(0);
      return;
    }

    visibleCountRef.current = 0;
    setVisibleCount(0);
    startedAtRef.current = null;
    const msPerSegment = 1000 / ASSISTANT_REVEAL_CHARACTERS_PER_SECOND;

    const revealNextFrame = (now: number) => {
      if (startedAtRef.current === null) {
        startedAtRef.current = now;
      }

      const elapsed = now - startedAtRef.current;
      const nextCount = Math.min(segments.length, Math.floor(elapsed / msPerSegment) + 1);

      if (nextCount !== visibleCountRef.current) {
        visibleCountRef.current = nextCount;
        setVisibleCount(nextCount);
      }

      if (nextCount < segments.length) {
        frameRef.current = window.requestAnimationFrame(revealNextFrame);
      }
    };

    frameRef.current = window.requestAnimationFrame(revealNextFrame);

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      startedAtRef.current = null;
    };
  }, [animate, onRevealStep, segments]);

  // Keep reveal-time layout identical to the settled layout so paragraph/list
  // spacing does not jump when the animation finishes.
  return <FormattedMessageText text={visibleText} />;
});

const FormattedMessageText = memo(function FormattedMessageText({ text }: { text: string }) {
  const blocks = useMemo(() => parseMessageText(text), [text]);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="messageTextStructured">
      {blocks.map((block, blockIndex) => {
        if (block.type === "unordered-list") {
          return (
            <ul key={blockIndex}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ordered-list") {
          return (
            <ol key={blockIndex} start={block.start}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={blockIndex}>
            {block.lines.map((line, lineIndex) => (
              <Fragment key={`${blockIndex}-${lineIndex}`}>
                {line}
                {lineIndex < block.lines.length - 1 ? <br /> : null}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
});

const BubbleTail = memo(function BubbleTail({
  bubbleHeight,
  bubbleWidth,
  side
}: {
  bubbleHeight: number;
  bubbleWidth: number;
  side: "assistant" | "user";
}) {
  const metrics = useMemo(() => createBubbleTailMetrics(bubbleWidth, bubbleHeight), [bubbleHeight, bubbleWidth]);
  const path = useMemo(
    () =>
      [
        `M ${metrics.bottomJoinX} ${metrics.bottomY}`,
        `C ${metrics.joinControlX} ${metrics.bottomY} ${metrics.tipUpperControlX} ${metrics.tipUpperControlY} ${metrics.tipX} ${metrics.tipY}`,
        `C ${metrics.tipLowerControlX} ${metrics.tipLowerControlY} ${metrics.rootX} ${metrics.rootReturnY} ${metrics.rootX} ${metrics.rootUpperY}`,
        `L ${metrics.rootX} ${metrics.bottomY}`,
        `L ${metrics.bottomJoinX} ${metrics.bottomY}`,
        "Z"
      ].join(" "),
    [metrics]
  );
  const style = useMemo(
    () => ({
      height: `${metrics.viewHeight}px`,
      top: `${metrics.topOffset}px`,
      width: `${metrics.viewWidth}px`
    }),
    [metrics]
  );

  return (
    <svg
      className={`bubbleTail ${side}`}
      viewBox={`0 0 ${metrics.viewWidth} ${metrics.viewHeight}`}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <g
        transform={
          side === "user" ? `translate(${metrics.viewWidth} 0) scale(-1 1)` : undefined
        }
      >
        <path d={path} fill="var(--bubble-tail-fill)" />
      </g>
    </svg>
  );
});

const BubbleOutline = memo(function BubbleOutline({
  bubbleHeight,
  bubbleWidth,
  side
}: {
  bubbleHeight: number;
  bubbleWidth: number;
  side: "assistant" | "user";
}) {
  const metrics = useMemo(() => createBubbleOutlineMetrics(bubbleWidth, bubbleHeight), [bubbleHeight, bubbleWidth]);
  const path = useMemo(() => {
    const topLeftX = metrics.bodyLeftX + metrics.bubbleRadius;
    const topRightX = metrics.bodyRightX - metrics.bubbleRadius;
    const bottomRightY = metrics.bubbleHeight - metrics.bubbleRadius;
    const bottomLeftCurveStartY = metrics.bubbleRadius;
    const bottomJoinControlX = metrics.bodyLeftX + clampNumber(metrics.bubbleWidth * 0.05, 6, 12);
    const tipUpperControlX = metrics.tipX + metrics.tailWidth * 0.26;
    const tipUpperControlY = metrics.tipY + metrics.tailDrop * 0.12;
    const tipLowerControlX = metrics.tipX + metrics.tailWidth * 0.16;
    const tipLowerControlY = metrics.tipY - metrics.tailDrop * 0.16;
    const rootReturnY = metrics.rootUpperY + (metrics.rootLowerY - metrics.rootUpperY) * 0.72;

    return [
      `M ${topLeftX} 0`,
      `H ${topRightX}`,
      `C ${metrics.bodyRightX - metrics.bubbleRadius * 0.42} 0 ${metrics.bodyRightX} ${metrics.bubbleRadius * 0.42} ${metrics.bodyRightX} ${metrics.bubbleRadius}`,
      `V ${bottomRightY}`,
      `C ${metrics.bodyRightX} ${metrics.bubbleHeight - metrics.bubbleRadius * 0.42} ${metrics.bodyRightX - metrics.bubbleRadius * 0.42} ${metrics.bubbleHeight} ${topRightX} ${metrics.bubbleHeight}`,
      `H ${metrics.bottomJoinX}`,
      `C ${bottomJoinControlX} ${metrics.bubbleHeight} ${tipUpperControlX} ${tipUpperControlY} ${metrics.tipX} ${metrics.tipY}`,
      `C ${tipLowerControlX} ${tipLowerControlY} ${metrics.bodyLeftX} ${rootReturnY} ${metrics.bodyLeftX} ${metrics.rootUpperY}`,
      `V ${bottomLeftCurveStartY}`,
      `C ${metrics.bodyLeftX} ${metrics.bubbleRadius * 0.42} ${metrics.bodyLeftX + metrics.bubbleRadius * 0.42} 0 ${topLeftX} 0`
    ].join(" ");
  }, [metrics]);
  const style = useMemo(
    () => ({
      height: `${metrics.viewHeight}px`,
      width: `${metrics.viewWidth}px`
    }),
    [metrics]
  );

  return (
    <svg
      className={`bubbleOutline ${side}`}
      viewBox={`0 0 ${metrics.viewWidth} ${metrics.viewHeight}`}
      style={style}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={path}
        fill="none"
        stroke="var(--bubble-border-color)"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        transform={side === "user" ? `translate(${metrics.viewWidth} 0) scale(-1 1)` : undefined}
      />
    </svg>
  );
});

const MessageBubble = memo(function MessageBubble({
  isLatestAssistantBubble,
  isLatestUserBubble,
  message,
  shouldAnimateAssistant,
  onRevealComplete,
  onRevealStep
}: {
  isLatestAssistantBubble: boolean;
  isLatestUserBubble: boolean;
  message: ChatMessage;
  shouldAnimateAssistant: boolean;
  onRevealComplete: (messageId: string) => void;
  onRevealStep: () => void;
}) {
  const bubbleSurfaceRef = useRef<HTMLDivElement | null>(null);
  const [bubbleSize, setBubbleSize] = useState<BubbleSize | null>(null);
  const tailSide =
    isLatestAssistantBubble && message.role === "assistant"
      ? "assistant"
      : isLatestUserBubble && message.role === "user"
        ? "user"
        : null;

  useLayoutEffect(() => {
    if (!tailSide) {
      setBubbleSize(null);
      return;
    }

    const bubble = bubbleSurfaceRef.current;
    if (!bubble) {
      return;
    }

    const measure = () => {
      const nextRect = bubble.getBoundingClientRect();
      setBubbleSize((current) =>
        current &&
        Math.abs(current.height - nextRect.height) < 0.5 &&
        Math.abs(current.width - nextRect.width) < 0.5
          ? current
          : {
              height: nextRect.height,
              width: nextRect.width
            }
      );
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }

    const observer = new ResizeObserver(() => measure());
    observer.observe(bubble);

    return () => observer.disconnect();
  }, [message.id, message.role, message.text, tailSide]);

  return (
    <div className={`msgRow ${message.role}`}>
      <div className={`bubble ${message.role} ${tailSide ? "tailed" : "plain"}`}>
        {tailSide && bubbleSize ? (
          <BubbleTail bubbleHeight={bubbleSize.height} bubbleWidth={bubbleSize.width} side={tailSide} />
        ) : null}
        {tailSide && bubbleSize ? (
          <BubbleOutline bubbleHeight={bubbleSize.height} bubbleWidth={bubbleSize.width} side={tailSide} />
        ) : null}
        <div className={`bubbleSurface ${message.role} ${tailSide ? "tailed" : "plain"}`} ref={bubbleSurfaceRef}>
          <div className={`bubbleBody ${shouldAnimateAssistant ? "revealing" : ""}`}>
            {shouldAnimateAssistant ? (
              <AnimatedAssistantText
                text={message.text}
                animate
                onRevealStep={onRevealStep}
                onRevealComplete={() => onRevealComplete(message.id)}
              />
            ) : (
              <FormattedMessageText text={message.text} />
            )}
          </div>
          <div className="bubbleMeta">{formatClock(message.createdAt)}</div>
        </div>
      </div>
    </div>
  );
});

const MessageList = memo(function MessageList({ messages }: { messages: ChatMessage[] }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null);
  const [revealedAssistantId, setRevealedAssistantId] = useState<string | null>(null);
  const lastMessageId = messages[messages.length - 1]?.id;
  const latestAssistantId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "assistant")?.id ?? null,
    [messages]
  );
  const latestUserId = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user")?.id ?? null,
    [messages]
  );

  function scrollToBottom() {
    const list = listRef.current;
    if (!list) {
      return;
    }

    bottomAnchorRef.current?.scrollIntoView({ block: "end" });
    list.scrollTop = list.scrollHeight;
  }

  useLayoutEffect(() => {
    scrollToBottom();
  }, [lastMessageId]);

  function handleRevealComplete(messageId: string) {
    setRevealedAssistantId((current) => (current === messageId ? current : messageId));
    scrollToBottom();
  }

  return (
    <div className="msgList" ref={listRef}>
      <div>
        {messages.map((message) => {
          const shouldAnimateAssistant =
            message.role === "assistant" && message.id === lastMessageId && message.id !== revealedAssistantId;

          return (
            <MessageBubble
              key={message.id}
              isLatestAssistantBubble={message.id === latestAssistantId}
              isLatestUserBubble={message.id === latestUserId}
              message={message}
              shouldAnimateAssistant={shouldAnimateAssistant}
              onRevealStep={scrollToBottom}
              onRevealComplete={handleRevealComplete}
            />
          );
        })}
        <div ref={bottomAnchorRef} />
      </div>
    </div>
  );
});

const AvatarDisplay = memo(function AvatarDisplay({
  renderModel,
  avatarAlt,
  avatarFallback,
  showThinkingBubble,
  thinkingLabel
}: {
  renderModel: AvatarRenderModel;
  avatarAlt: string;
  avatarFallback: string;
  showThinkingBubble: boolean;
  thinkingLabel: string;
}) {
  return (
    <div className="avatarDock">
      {showThinkingBubble && (
        <div className="avatarThoughtBubble" role="status" aria-live="polite" aria-label={thinkingLabel}>
          <span className="thinkingDots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        </div>
      )}
      <div className="avatarStage">
        <div className="avatarClip">
          <AvatarMediaPlayer renderModel={renderModel} avatarAlt={avatarAlt} avatarFallback={avatarFallback} />
        </div>
      </div>
    </div>
  );
});

export default function App() {
  const { controller, runtime, manifest } = useAvatarController();
  const [locale, setLocale] = useState<UiLocale>(getInitialLocale);
  const chat = useChatSession(locale);
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDevUiOpen, setIsDevUiOpen] = useState(false);
  const [pendingReplyAnimation, setPendingReplyAnimation] = useState<AssistantDirective["animation"] | null>(null);
  const visibleRenderModel = useStableAvatarRenderModel(runtime.renderModel);

  const chatServiceReady = chat.serviceStatus.configured;
  const ui = UI_TEXT[locale];
  const stateLabels = locale === "en" ? STATE_LABELS_EN : STATE_LABELS;
  usePreloadedAvatarAssets(manifest);

  useEffect(() => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
  }, [locale]);

  useLayoutEffect(() => {
    if (!pendingReplyAnimation) {
      return;
    }

    const lastMessage = chat.messages[chat.messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") {
      return;
    }

    const targetState = pendingReplyAnimation.target_state;
    controller.requestState(targetState, {
      shouldHold: targetState === "speaking_explain" ? false : pendingReplyAnimation.should_hold,
      isActiveTrigger: true
    });
    setPendingReplyAnimation(null);
  }, [chat.messages, controller, pendingReplyAnimation]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || chat.isLoading || !chatServiceReady) return;

    setInput("");
    setLocalError(null);
    controller.requestState("thinking_process", { shouldHold: true, isActiveTrigger: true });

    try {
      const directive = await chat.sendUserMessage(text);
      setPendingReplyAnimation(directive.animation);
    } catch (error) {
      const message = error instanceof Error ? error.message : ui.unknownError;
      setLocalError(message);
      controller.requestState("warm_friendly", { shouldHold: false, isActiveTrigger: true });
    }
  }

  function handleInputChange(value: string) {
    setInput(value);

    if (!chat.isLoading && value.trim()) {
      if (runtime.currentState === "listening_attentive" && !runtime.isTransitioning) {
        return;
      }
      controller.requestState("listening_attentive", { shouldHold: true, isActiveTrigger: true });
      return;
    }

    if (!chat.isLoading && !value.trim()) {
      if (runtime.currentState === "idle_neutral" && !runtime.isTransitioning) {
        return;
      }
      controller.requestState("idle_neutral", { shouldHold: true, isActiveTrigger: true });
    }
  }

  return (
    <div className="app">
      <section className="chatShell">
        <header className="header">
          <div className="brand">
            <div className="headerTitle">{ui.title}</div>
            <div className="headerSubtitle">{chat.isLoading ? ui.subtitleLoading : ui.subtitleIdle}</div>
          </div>
          <div className="headerActions">
            <div className="localeToggle" role="group" aria-label={ui.localeToggleLabel}>
              <button
                className={`localeBtn ${locale === "zh" ? "active" : ""}`}
                type="button"
                onClick={() => setLocale("zh")}
              >
                中文
              </button>
              <button
                className={`localeBtn ${locale === "en" ? "active" : ""}`}
                type="button"
                onClick={() => setLocale("en")}
              >
                EN
              </button>
            </div>
            <button
              className={`devToggle ${isDevUiOpen ? "active" : ""}`}
              type="button"
              onClick={() => setIsDevUiOpen((prev) => !prev)}
            >
              {ui.devToggle}
            </button>
          </div>
        </header>

        {isDevUiOpen && (
          <section className="devPanel">
            <div className="devPanelTitle">{ui.devPanelTitle}</div>
            <div className="devGrid">
              <div className="devItem">
                <span>{ui.currentState}</span>
                <strong>{stateLabels[runtime.currentState]} ({runtime.currentState})</strong>
              </div>
              <div className="devItem">
                <span>{ui.playback}</span>
                <strong>{runtime.playbackKind}</strong>
              </div>
              <div className="devItem">
                <span>{ui.direction}</span>
                <strong>{runtime.playDirection}</strong>
              </div>
              <div className="devItem">
                <span>{ui.currentLoop}</span>
                <strong>{runtime.currentLoopAsset?.id ?? ui.none}</strong>
              </div>
              <div className="devItem">
                <span>{ui.currentTransition}</span>
                <strong>{runtime.currentTransitionAsset?.id ?? ui.none}</strong>
              </div>
              <div className="devItem">
                <span>{ui.targetState}</span>
                <strong>{runtime.targetState ?? ui.none}</strong>
              </div>
              <div className="devItem wide">
                <span>{ui.lastRoute}</span>
                <strong>{runtime.lastRouteDescription}</strong>
              </div>
              <div className="devItem wide">
                <span>{ui.chatApi}</span>
                <strong>
                  {chatServiceReady ? ui.configured : ui.notConfigured}
                </strong>
              </div>
              <div className="devItem">
                <span>{ui.endpoint}</span>
                <strong>{chat.serviceStatus.endpoint || getChatApiEndpoint()}</strong>
              </div>
              <div className="devItem">
                <span>{ui.model}</span>
                <strong>{chat.serviceStatus.model ?? ui.none}</strong>
              </div>
              {chat.serviceStatusError && (
                <div className="devItem wide error">
                  <span>{ui.chatApi}</span>
                  <strong>{chat.serviceStatusError}</strong>
                </div>
              )}
              {localError && (
                <div className="devItem wide error">
                  <span>{ui.recentError}</span>
                  <strong>{localError}</strong>
                </div>
              )}
            </div>
          </section>
        )}

        <MessageList messages={chat.messages} />

        <div className="footerBar">
          <AvatarDisplay
            renderModel={visibleRenderModel}
            avatarAlt={ui.avatarAlt}
            avatarFallback={ui.avatarFallback}
            showThinkingBubble={chat.isLoading}
            thinkingLabel={ui.thinking}
          />

          <form className="composer" onSubmit={onSubmit}>
            <input
              className="input"
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={chatServiceReady ? ui.inputPlaceholder : ui.inputDisabledPlaceholder}
              disabled={!chatServiceReady}
            />
            <button className="btn" type="submit" disabled={chat.isLoading || !input.trim() || !chatServiceReady}>
              {chat.isLoading ? ui.thinking : ui.send}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
