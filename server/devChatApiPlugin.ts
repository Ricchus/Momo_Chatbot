import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import type { PluginOption } from "vite";
import { handleChatFunctionRequest } from "./chatFunction";

function toRequestHeaders(headers: IncomingHttpHeaders) {
  const result = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        result.append(key, item);
      }
      continue;
    }

    if (typeof value === "string") {
      result.set(key, value);
    }
  }

  return result;
}

function requestCanHaveBody(method?: string) {
  const upper = method?.toUpperCase();
  return upper !== "GET" && upper !== "HEAD";
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Uint8Array[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return Buffer.concat(chunks);
}

async function writeResponse(response: Response, serverResponse: ServerResponse) {
  serverResponse.statusCode = response.status;

  response.headers.forEach((value, key) => {
    serverResponse.setHeader(key, value);
  });

  const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
  serverResponse.end(body);
}

export function createDevChatApiPlugin(): PluginOption {
  return {
    name: "local-chat-api",
    configureServer(server) {
      server.middlewares.use("/api/chat", async (request, response, next) => {
        try {
          const origin = `http://${request.headers.host ?? "localhost:5173"}`;
          const body = requestCanHaveBody(request.method) ? await readRequestBody(request) : undefined;
          const apiRequest = new Request(new URL(request.url ?? "/", origin), {
            method: request.method,
            headers: toRequestHeaders(request.headers),
            body
          });
          const apiResponse = await handleChatFunctionRequest(apiRequest);
          await writeResponse(apiResponse, response);
        } catch (error) {
          next(error as Error);
        }
      });
    }
  };
}
