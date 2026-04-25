import type { IncomingMessage, ServerResponse } from "node:http";
import { handleChatFunctionRequest } from "../server/chatFunction.js";

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

function toWebHeaders(headers: IncomingMessage["headers"]) {
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

async function writeWebResponse(response: Response, serverResponse: ServerResponse) {
  serverResponse.statusCode = response.status;

  response.headers.forEach((value, key) => {
    serverResponse.setHeader(key, value);
  });

  const body = response.body ? Buffer.from(await response.arrayBuffer()) : undefined;
  serverResponse.end(body);
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const protocolHeader = request.headers["x-forwarded-proto"];
  const protocol = Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader;
  const origin = `${protocol ?? "https"}://${request.headers.host ?? "localhost"}`;
  const body = requestCanHaveBody(request.method) ? await readRequestBody(request) : undefined;
  const webRequest = new Request(new URL(request.url ?? "/", origin), {
    method: request.method,
    headers: toWebHeaders(request.headers),
    body
  });
  const webResponse = await handleChatFunctionRequest(webRequest);
  await writeWebResponse(webResponse, response);
}
