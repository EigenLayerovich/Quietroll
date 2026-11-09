"use client";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Call this app's own API and unwrap its `{ error: { code, message } }` shape. */
export async function call<T>(path: string, body?: unknown, method?: "GET" | "POST"): Promise<T> {
  const m = method ?? (body === undefined ? "GET" : "POST");
  const res = await fetch(path, {
    method: m,
    headers: m === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: m === "POST" ? JSON.stringify(body ?? {}) : undefined,
    credentials: "same-origin",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } }).error;
    throw new ApiError(e?.code ?? "HTTP_ERROR", e?.message ?? `Request failed (HTTP ${res.status})`, res.status);
  }
  return json as T;
}

export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const r = await call<{ result?: T; error?: { message?: string } }>("/api/rpc", { method, params });
  if (r.error) throw new ApiError("RPC_ERROR", r.error.message ?? "Solana RPC error", 502);
  return r.result as T;
}
