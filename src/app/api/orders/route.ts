import { mutationPOST, ordersGET } from "@/lib/server/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = ordersGET;
export { methodNotAllowed as HEAD, methodNotAllowed as OPTIONS } from "@/lib/server/routes";
export function POST(request: Request) {
  return mutationPOST(request, "confirm", "/api/orders");
}
