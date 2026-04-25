import type { AnchorState } from "../avatar/types";

export type UiLocale = "zh" | "en";

export type UiTone =
  | "neutral"
  | "calm_supportive"
  | "warm_light"
  | "gentle_concern"
  | "light_positive";

export type SemanticIntent =
  | "welcome"
  | "smalltalk"
  | "explain"
  | "instruction"
  | "praise"
  | "empathy"
  | "clarify"
  | "close";

export type AssistantDirective = {
  version: "1.0";
  reply: {
    text: string;
    language: UiLocale;
    address_user_as: "老板" | "Boss";
  };
  animation: {
    semantic_intent: SemanticIntent;
    target_state: AnchorState;
    tone: UiTone;
    should_hold: boolean;
  };
  meta: {
    persona_version: string;
    schema_version: "assistant_directive_v1";
    uncertainty_note: string;
  };
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system-error";
  text: string;
  createdAt: number;
};

export type ChatServiceStatus = {
  configured: boolean;
  endpoint: string;
  model: string | null;
};
