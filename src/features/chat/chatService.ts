import { getChatApiEndpoint } from "./clientConfig";
import { normalizeDirective } from "./directiveUtils";
import type { ChatMessage, ChatServiceStatus, UiLocale } from "./types";

type ChatApiErrorBody = {
  error?: string;
};

function buildRequestFailedMessage(preferredLanguage: UiLocale) {
  return preferredLanguage === "en"
    ? "Request failed. Check the network, Vercel function logs, and server environment variables."
    : "请求失败，请检查网络、Vercel Function 日志和服务端环境变量。";
}

async function readErrorMessage(response: Response, preferredLanguage: UiLocale) {
  try {
    const parsed = (await response.json()) as ChatApiErrorBody;
    if (typeof parsed?.error === "string" && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // Ignore JSON parsing errors and use the fallback message below.
  }

  return buildRequestFailedMessage(preferredLanguage);
}

export async function fetchChatServiceStatus(): Promise<ChatServiceStatus> {
  const endpoint = getChatApiEndpoint();
  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, "en"));
  }

  const parsed = (await response.json()) as Record<string, unknown>;
  return {
    configured: parsed.configured === true,
    endpoint,
    model: typeof parsed.model === "string" ? parsed.model : null
  };
}

export async function requestAssistantDirective(history: ChatMessage[], preferredLanguage: UiLocale) {
  const response = await fetch(getChatApiEndpoint(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify({
      history,
      preferredLanguage
    })
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, preferredLanguage));
  }

  const parsed = await response.json();
  return normalizeDirective(parsed, preferredLanguage);
}
