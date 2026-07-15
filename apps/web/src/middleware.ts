import { NextResponse, type NextRequest } from "next/server";

function getServerTarget() {
  return process.env["SERVER_API_URL"] ?? process.env["NEXT_PUBLIC_SERVER_URL"] ?? "http://127.0.0.1:4000";
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const isSocket = pathname === "/socket.io" || pathname.startsWith("/socket.io/");
  if (!isApi && !isSocket) {
    return NextResponse.next();
  }

  const targetUrl = new URL(`${getServerTarget()}${pathname}${search}`);
  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has("x-forwarded-proto")) {
    requestHeaders.set("x-forwarded-proto", request.nextUrl.protocol.replace(":", ""));
  }
  return NextResponse.rewrite(targetUrl, {
    request: { headers: requestHeaders }
  });
}

export const config = {
  matcher: ["/api/:path*", "/socket.io", "/socket.io/:path*"]
};
