import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import type { Context, Mutation, MutationInput } from "./types";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors: Record<string, string> = {},
    public context?: Context,
  ) {
    super(message);
  }
}

export function invalid(field: string, message: string, code = "INVALID_INPUT"): never {
  throw new ApiError(400, code, message, { [field]: message });
}

export function missing(): never {
  throw new ApiError(404, "NOT_FOUND", "No se encontró el recurso.");
}

export function sessionRequired(): never {
  throw new ApiError(401, "SESSION_REQUIRED", "No podemos acceder a tu sesión.");
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function configuredOrigins(): URL[] {
  const values: string[] = [];
  if (process.env.APP_ORIGIN) values.push(process.env.APP_ORIGIN);
  if (process.env.VERCEL_URL) values.push(`https://${process.env.VERCEL_URL}`);
  return values.map((value) => {
    const url = new URL(value);
    if (
      url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || !["https:", "http:"].includes(url.protocol)
    ) throw new Error("Invalid trusted origin configuration");
    // HTTP cookies are permitted only for an explicitly configured local runner.
    if (url.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error("HTTP requires a local trusted origin");
    }
    return url;
  });
}

export function checkOrigin(request: Request): URL {
  const origin = request.headers.get("origin");
  const trusted = configuredOrigins().find((url) => url.origin === origin);
  if (!trusted) {
    throw new ApiError(403, "ORIGIN_REJECTED", "No se permite este origen.");
  }
  return trusted;
}

export function tokenHash(request: Request): string | null {
  const matches = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith("tm_session="));
  if (matches.length !== 1) return null;
  const token = matches[0].slice("tm_session=".length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return hash(token);
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function newSecret() {
  const secret = randomBytes(32).toString("base64url");
  return { secret, digest: hash(secret) };
}

export function success(body: unknown) {
  return NextResponse.json(body, {
    status: 200,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export function withCookie(body: Context, secret: string, origin: URL) {
  const response = success(body);
  const secure = origin.protocol === "https:";
  response.cookies.set("tm_session", secret, {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    partitioned: secure,
    path: "/",
  });
  return response;
}

export async function handle(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action();
  } catch (error) {
    const known = error instanceof ApiError;
    const status = known ? error.status : 500;
    return NextResponse.json({
      error: {
        code: known ? error.code : "SERVER_ERROR",
        message: known ? error.message : "No pudimos completar la solicitud. Reintenta.",
        fieldErrors: known ? error.fieldErrors : {},
      },
      ...(known && error.context ? { context: error.context } : {}),
    }, {
      status,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new ApiError(400, "INVALID_JSON", "Envía un objeto JSON.", { body: "Envía un objeto JSON." });
  }
  // Stream with a hard bound; an absent or dishonest Content-Length cannot
  // force buffering an unbounded body.
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "INVALID_JSON", "Envía un objeto JSON.", { body: "Envía un objeto JSON." });
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 8192) {
        await reader.cancel();
        throw new Error("Body limit");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body: unknown = JSON.parse(text);
    if (body === null || Array.isArray(body) || typeof body !== "object") throw new Error("Object required");
    return body as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Envía un objeto JSON válido.", { body: "Envía un objeto JSON válido." });
  } finally {
    reader.releaseLock();
  }
}

export function exactFields(body: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unknown.length) {
    throw new ApiError(400, "UNKNOWN_FIELD", "La solicitud contiene campos no permitidos.",
      Object.fromEntries(unknown.map((key) => [key, "Este campo no está permitido."])));
  }
}

export function validateMutation(body: Record<string, unknown>, kind: Mutation): MutationInput {
  const envelope = ["cartId", "expectedVersion", "idempotencyKey"];
  exactFields(body, [
    ...envelope,
    ...(kind === "items" ? ["productId", "operation", "quantity"] : kind === "remove" ? ["productId"] : []),
  ]);
  for (const key of ["cartId", "idempotencyKey"]) {
    if (typeof body[key] !== "string" || !uuidPattern.test(body[key])) {
      invalid(key, "Se requiere un identificador válido.");
    }
  }
  if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0) {
    invalid("expectedVersion", "Se requiere una versión entera válida.");
  }
  if (kind === "items" || kind === "remove") {
    if (typeof body.productId !== "string" || !/^[a-z][a-z-]{0,63}$/.test(body.productId)) {
      invalid("productId", "Selecciona un producto válido.", "INVALID_PRODUCT");
    }
  }
  if (kind === "items") {
    if (body.operation !== "increment" && body.operation !== "set") {
      invalid("operation", "Elige una operación válida.");
    }
    if (!Number.isInteger(body.quantity) || (body.quantity as number) < 1 || (body.quantity as number) > 20) {
      invalid("quantity", "Escribe un número entero del 1 al 20.", "QUANTITY_RANGE");
    }
  }
  return body as MutationInput;
}

export function payloadHash(body: MutationInput) {
  return hash(JSON.stringify(Object.fromEntries(
    Object.entries(body).sort(([left], [right]) => left.localeCompare(right)),
  )));
}
