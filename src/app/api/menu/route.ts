import { menuGET } from "@/lib/server/routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = menuGET;
export { methodNotAllowed as HEAD, methodNotAllowed as OPTIONS } from "@/lib/server/routes";
