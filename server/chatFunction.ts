import OpenAI from "openai";
import { buildInstructions } from "../src/features/chat/promptBuilder";
import { assistantDirectiveSchema } from "../src/features/chat/responseSchema";
import { normalizeDirective } from "../src/features/chat/directiveUtils";
import type { ChatMessage, UiLocale } from "../src/features/chat/types";

const DEFAULT_MODEL = "gpt-4.1-mini";
const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8"
} as const;

let cachedClient: { apiKey: string; client: OpenAI } | null = null;

function readServerConfig() {
  const apiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  const model = process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  return {
    apiKey,
    configured: apiKey.length > 10,
    model
  };
}

function getOpenAIClient(apiKey: string) {
  if (!cachedClient || cachedClient.apiKey !== apiKey) {
    cachedClient = {
      apiKey,
      client: new OpenAI({ apiKey })
    };
  }

  return cachedClient.client;
}

function isUiLocale(value: unknown): value is UiLocale {
  return value === "zh" || value === "en";
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const maybe = value as Record<string, unknown>;
  return (
    typeof maybe.id === "string" &&
    (maybe.role === "user" || maybe.role === "assistant" || maybe.role === "system-error") &&
    typeof maybe.text === "string" &&
    typeof maybe.createdAt === "number"
  );
}

function parseRequestBody(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const maybe = value as Record<string, unknown>;
  if (!isUiLocale(maybe.preferredLanguage)) {
    throw new Error('preferredLanguage must be "zh" or "en".');
  }

  if (!Array.isArray(maybe.history) || !maybe.history.every(isChatMessage)) {
    throw new Error("history must be an array of chat messages.");
  }

  return {
    history: maybe.history,
    preferredLanguage: maybe.preferredLanguage
  };
}

function buildTranscriptInput(history: ChatMessage[], preferredLanguage: UiLocale) {
  const speakerLabels =
    preferredLanguage === "en"
      ? { user: "User", assistant: "Assistant" }
      : { user: "用户", assistant: "助手" };

  const transcript = history
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-12)
    .map((item) => `${item.role === "user" ? speakerLabels.user : speakerLabels.assistant}: ${item.text}`)
    .join("\n\n");

  return preferredLanguage === "en"
    ? `Continue the conversation below and return strict JSON.\n\n${transcript}`
    : `请基于下面的对话历史继续回答，并输出严格 JSON。\n\n${transcript}`;
}

async function requestAssistantDirective(history: ChatMessage[], preferredLanguage: UiLocale) {
  const { apiKey, model } = readServerConfig();
  const client = getOpenAIClient(apiKey);
  const response = await client.responses.create({
    model,
    instructions: buildInstructions(preferredLanguage),
    input: buildTranscriptInput(history, preferredLanguage),
    text: {
      format: {
        type: "json_schema",
        name: "assistant_directive",
        schema: assistantDirectiveSchema,
        strict: true
      }
    }
  });

  const outputText = response.output_text?.trim() ?? "";
  if (!outputText) {
    return normalizeDirective(null, preferredLanguage);
  }

  const parsed = JSON.parse(outputText);
  return normalizeDirective(parsed, preferredLanguage);
}

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, {
    headers: JSON_HEADERS,
    ...init
  });
}

export async function handleChatFunctionRequest(request: Request) {
  if (request.method === "GET") {
    const { configured, model } = readServerConfig();
    return json({
      configured,
      model,
      mode: "serverless"
    });
  }

  if (request.method !== "POST") {
    return json(
      { error: "Method not allowed." },
      {
        status: 405,
        headers: {
          ...JSON_HEADERS,
          allow: "GET, POST"
        }
      }
    );
  }

  const { configured } = readServerConfig();
  if (!configured) {
    return json(
      {
        error: "Server is missing OPENAI_API_KEY. Set it in Vercel Environment Variables or your local .env.local file."
      },
      { status: 503 }
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let payload: ReturnType<typeof parseRequestBody>;
  try {
    payload = parseRequestBody(parsedBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body.";
    return json({ error: message }, { status: 400 });
  }

  try {
    const directive = await requestAssistantDirective(payload.history, payload.preferredLanguage);
    return json(directive);
  } catch (error) {
    console.error("[chat api] request failed", error);
    const message =
      error instanceof Error ? error.message : "The server failed while contacting the model provider.";
    return json({ error: message }, { status: 500 });
  }
}
