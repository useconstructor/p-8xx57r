import "server-only";
import { ApiError, checkOrigin, exactFields, handle, readObject, success, validateMutation, withCookie } from "./http";
import { initializeSession, mutate, readCart, readMenu, readOrder, readOrders } from "./store";
import type { Mutation } from "./types";

export function methodNotAllowed() {
  return handle(async () => {
    throw new ApiError(405, "METHOD_NOT_ALLOWED", "Este método no está permitido.");
  });
}

export function menuGET() {
  return handle(async () => success(await readMenu()));
}

export function sessionPOST(request: Request) {
  return handle(async () => {
    const origin = checkOrigin(request);
    exactFields(await readObject(request), []);
    const result = await initializeSession(request);
    return result.secret ? withCookie(result.context, result.secret, origin) : success(result.context);
  });
}

export function cartGET(request: Request) {
  return handle(async () => success(await readCart(request)));
}

export function ordersGET(request: Request) {
  return handle(async () => success(await readOrders(request)));
}

export function orderGET(request: Request, id: string) {
  return handle(async () => success(await readOrder(request, id)));
}

export function mutationPOST(request: Request, kind: Mutation, endpoint: string) {
  return handle(async () => {
    checkOrigin(request);
    const body = validateMutation(await readObject(request), kind);
    return success(await mutate(request, kind, endpoint, body));
  });
}
