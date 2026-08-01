/**
 * ============================================================================
 * DASHBOARD PROXY (Next.js middleware)
 * ============================================================================
 * Phase 1 · Stage 1A: dashboard username/password authentication was removed.
 * The dashboard now opens directly. This middleware preserves the CSRF /
 * cross-site guard on mutating API calls, which is unrelated to the login UI
 * and remains valuable defense in depth for any browser-mounted UI.
 *
 * REMOVED IN STAGE 1A:
 *  • DASHBOARD_PASSWORD / session cookie / /login redirect chain
 *  • app/login/page.tsx
 *  • app/api/auth/login/route.ts
 *  • app/api/auth/logout/route.ts
 *  • lib/v2/engine/dashboard-auth.ts
 *  • tests/unit/auth.test.ts
 *
 * PRESERVED:
 *  • Same-origin (Sec-Fetch-Site / Origin) check on mutating API calls
 *  • Backend HMAC / signing paths inside individual engine routes are NOT
 *    part of the dashboard UI auth and are untouched
 * ============================================================================
 */
import { NextResponse, type NextRequest } from "next/server"

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // CSRF hard-stop for mutating API calls: reject requests a browser marks as
  // cross-site. This runs whether or not a user is signed in — the dashboard
  // UI itself no longer requires a session, but any API mutation still
  // requires a same-origin caller.
  if (pathname.startsWith("/api/") && req.method !== "GET" && req.method !== "HEAD") {
    const secFetchSite = req.headers.get("sec-fetch-site")
    if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
      return NextResponse.json({ ok: false, message: "Cross-site request rejected" }, { status: 403 })
    }
    const origin = req.headers.get("origin")
    if (origin) {
      const reqHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
      try {
        if (new URL(origin).host !== reqHost) {
          return NextResponse.json({ ok: false, message: "Origin mismatch — request rejected" }, { status: 403 })
        }
      } catch {
        return NextResponse.json({ ok: false, message: "Invalid Origin header" }, { status: 403 })
      }
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)"],
}
