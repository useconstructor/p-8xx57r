import { orderGET } from "@/lib/server/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export { methodNotAllowed as HEAD, methodNotAllowed as OPTIONS } from "@/lib/server/routes";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return orderGET(request, (await params).id);
}
