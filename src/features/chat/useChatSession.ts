import { useEffect, useMemo, useState } from "react";
import { fetchChatServiceStatus, requestAssistantDirective } from "./chatService";
import type { AssistantDirective, ChatMessage, ChatServiceStatus, UiLocale } from "./types";

const INITIAL_ASSISTANT_TEXT: Record<UiLocale, string> = {
  zh: "老板你好，我是帽帽。",
  en: "Hi Boss, I'm Momo."
};

const DEFAULT_GREETING_TEXTS = new Set(Object.values(INITIAL_ASSISTANT_TEXT));

function uid(prefix = "msg") {
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

export function useChatSession(locale: UiLocale) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid("assistant"),
      role: "assistant",
      text: INITIAL_ASSISTANT_TEXT[locale],
      createdAt: Date.now()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [serviceStatus, setServiceStatus] = useState<ChatServiceStatus>({
    configured: true,
    endpoint: "/api/chat",
    model: null
  });
  const [serviceStatusError, setServiceStatusError] = useState<string | null>(null);

  useEffect(() => {
    setMessages((prev) => {
      if (prev.length !== 1 || prev[0]?.role !== "assistant" || !DEFAULT_GREETING_TEXTS.has(prev[0].text)) {
        return prev;
      }

      const nextText = INITIAL_ASSISTANT_TEXT[locale];
      if (prev[0].text === nextText) {
        return prev;
      }

      return [{ ...prev[0], text: nextText }];
    });
  }, [locale]);

  useEffect(() => {
    let cancelled = false;

    fetchChatServiceStatus()
      .then((nextStatus) => {
        if (cancelled) {
          return;
        }

        setServiceStatus(nextStatus);
        setServiceStatusError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setServiceStatus((current) => ({
          ...current,
          configured: false
        }));
        setServiceStatusError(error instanceof Error ? error.message : "Failed to load chat service status.");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo(
    () => ({
      messages,
      isLoading,
      serviceStatus,
      serviceStatusError,
      async sendUserMessage(text: string): Promise<AssistantDirective> {
        const userMessage: ChatMessage = {
          id: uid("user"),
          role: "user",
          text,
          createdAt: Date.now()
        };

        const nextHistory = [...messages, userMessage];
        setMessages(nextHistory);
        setIsLoading(true);

        try {
          const directive = await requestAssistantDirective(nextHistory, locale);
          const assistantMessage: ChatMessage = {
            id: uid("assistant"),
            role: "assistant",
            text: directive.reply.text,
            createdAt: Date.now()
          };
          setMessages((prev) => [...prev, assistantMessage]);
          return directive;
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : locale === "en"
                ? "An unknown error occurred. Check the network, model name, and server environment variables."
                : "发生未知错误，请检查网络、模型名称和服务端环境变量。";
          setMessages((prev) => [
            ...prev,
            {
              id: uid("error"),
              role: "system-error",
              text: locale === "en" ? `Request failed: ${message}` : `请求失败：${message}`,
              createdAt: Date.now()
            }
          ]);
          throw error;
        } finally {
          setIsLoading(false);
        }
      }
    }),
    [isLoading, locale, messages, serviceStatus, serviceStatusError]
  );

  return api;
}
