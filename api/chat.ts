import { handleChatFunctionRequest } from "../server/chatFunction";

export function GET(request: Request) {
  return handleChatFunctionRequest(request);
}

export function POST(request: Request) {
  return handleChatFunctionRequest(request);
}
