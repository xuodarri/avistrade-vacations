import { NextResponse, type NextRequest } from "next/server";

// Проверка живости (HEAD /) получает 200, а не редирект на домашний экран роли:
// превью-окно считает 307 «сервер ещё не готов» и в итоге гасит dev-сервер.
export function proxy(request: NextRequest) {
  if (request.method === "HEAD") return new NextResponse(null, { status: 200 });
  return NextResponse.next();
}

export const config = { matcher: "/" };
