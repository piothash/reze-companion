import { describe, it, expect, vi } from "vitest"

// Phase 1 · Stage 1B — pin the dashboard-auth removal so a future revert
// cannot silently re-introduce the login redirect. The proxy middleware is
// exercised directly with a minimal NextRequest stand-in (the runtime here
// is Node under vitest, not the Next edge runtime — we mock the framework
// surface).

vi.mock("next/server", () => {
  class NextResponse {
    status: number
    body: unknown
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body
      this.status = init?.status ?? 200
    }
    static next() { return new NextResponse(null, { status: 200 }) }
    static json(body: unknown, init?: { status?: number }) { return new NextResponse(body, init) }
    static redirect(_url: URL) { return new NextResponse(null, { status: 307 }) }
  }
  return { NextResponse }
})

function mkReq(opts: { method?: string; pathname?: string; headers?: Record<string, string> } = {}) {
  const headers = new Map(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
  return {
    method: opts.method ?? "GET",
    nextUrl: { pathname: opts.pathname ?? "/" },
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
  } as unknown as import("next/server").NextRequest
}

describe("proxy (dashboard auth removed, CSRF preserved)", () => {
  it("does NOT redirect the dashboard to /login (regression pin for auth removal)", async () => {
    const { default: proxy } = await import("../../proxy")
    const res = proxy(mkReq({ pathname: "/" })) as unknown as { status: number }
    expect(res.status).toBe(200)
  })

  it("does NOT redirect a deep dashboard route to /login either", async () => {
    const { default: proxy } = await import("../../proxy")
    const res = proxy(mkReq({ pathname: "/v2/live" })) as unknown as { status: number }
    expect(res.status).toBe(200)
  })

  it("allows same-origin API mutations (dashboard's own fetches)", async () => {
    const { default: proxy } = await import("../../proxy")
    const res = proxy(mkReq({
      method: "POST",
      pathname: "/api/engine/start",
      headers: { "sec-fetch-site": "same-origin" },
    })) as unknown as { status: number }
    expect(res.status).toBe(200)
  })

  it("rejects cross-site API mutations (CSRF guard still active)", async () => {
    const { default: proxy } = await import("../../proxy")
    const res = proxy(mkReq({
      method: "POST",
      pathname: "/api/engine/start",
      headers: { "sec-fetch-site": "cross-site" },
    })) as unknown as { status: number }
    expect(res.status).toBe(403)
  })

  it("rejects Origin/Host mismatch on API mutations", async () => {
    const { default: proxy } = await import("../../proxy")
    const res = proxy(mkReq({
      method: "POST",
      pathname: "/api/engine/stop",
      headers: { origin: "https://evil.example.com", host: "dashboard.local" },
    })) as unknown as { status: number }
    expect(res.status).toBe(403)
  })

  it("does NOT apply the CSRF guard to GETs (dashboard reads)", async () => {
    const { default: proxy } = await import("../../proxy")
    const res = proxy(mkReq({
      method: "GET",
      pathname: "/api/engine/status",
      headers: { "sec-fetch-site": "cross-site" },
    })) as unknown as { status: number }
    expect(res.status).toBe(200)
  })
})
