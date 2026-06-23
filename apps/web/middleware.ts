import { NextResponse, type NextRequest } from "next/server";

const TARGET = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://127.0.0.1:4000";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isSocket = pathname === "/socket.io" || pathname.startsWith("/socket.io/");
  if (!isApi && !isSocket) {
    return NextResponse.next();
  }

  const targetUrl = new URL(`${TARGET}${pathname}${search}`);
  return NextResponse.rewrite(targetUrl);
}

export const config = {
  matcher: ["/api/:path*", "/socket.io", "/socket.io/:path*"]
};
