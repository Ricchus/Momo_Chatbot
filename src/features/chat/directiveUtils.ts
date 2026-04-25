import { isAnchorState } from "../avatar/avatarConfig";
import { PERSONA_VERSION } from "./promptBuilder";
import type { AssistantDirective, UiLocale } from "./types";

function buildFallbackReply(preferredLanguage: UiLocale) {
  return preferredLanguage === "en"
    ? {
        text: "Boss, I couldn't get a stable structured result that time. Try again and I'll keep helping.",
        language: "en" as const,
        address_user_as: "Boss" as const
      }
    : {
        text: "老板，我这次没能稳定拿到结构化结果。你再试一次，我会继续帮你。",
        language: "zh" as const,
        address_user_as: "老板" as const
      };
}

export function buildFallbackDirective(preferredLanguage: UiLocale): AssistantDirective {
  return {
    version: "1.0",
    reply: buildFallbackReply(preferredLanguage),
    animation: {
      semantic_intent: "clarify",
      target_state: "warm_friendly",
      tone: "calm_supportive",
      should_hold: false
    },
    meta: {
      persona_version: PERSONA_VERSION,
      schema_version: "assistant_directive_v1",
      uncertainty_note: ""
    }
  };
}

export function normalizeDirective(value: unknown, preferredLanguage: UiLocale): AssistantDirective {
  const fallback = buildFallbackDirective(preferredLanguage);

  if (!value || typeof value !== "object") {
    return fallback;
  }

  const maybe = value as Record<string, unknown>;
  const reply = maybe.reply as Record<string, unknown> | undefined;
  const animation = maybe.animation as Record<string, unknown> | undefined;
  const meta = maybe.meta as Record<string, unknown> | undefined;

  if (
    maybe.version !== "1.0" ||
    !reply ||
    typeof reply.text !== "string" ||
    (reply.language !== "zh" && reply.language !== "en") ||
    (reply.address_user_as !== "老板" && reply.address_user_as !== "Boss") ||
    !animation ||
    typeof animation.semantic_intent !== "string" ||
    !isAnchorState(animation.target_state) ||
    typeof animation.tone !== "string" ||
    typeof animation.should_hold !== "boolean" ||
    !meta ||
    typeof meta.persona_version !== "string" ||
    meta.schema_version !== "assistant_directive_v1" ||
    typeof meta.uncertainty_note !== "string"
  ) {
    return fallback;
  }

  return maybe as unknown as AssistantDirective;
}
