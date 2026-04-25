const DEFAULT_CHAT_API_ENDPOINT = "/api/chat";

export function getChatApiEndpoint() {
  const configured = import.meta.env.VITE_CHAT_API_URL?.trim();
  return configured ? configured : DEFAULT_CHAT_API_ENDPOINT;
}
