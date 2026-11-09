import { mutationPOST } from "@/lib/server/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { methodNotAllowed as OPTIONS } from "@/lib/server/routes";
export function POST(request: Request) {
  return mutationPOST(request, "new", "/api/cart/new");
}
