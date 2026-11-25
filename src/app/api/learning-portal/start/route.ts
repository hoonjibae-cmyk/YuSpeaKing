import { startPortalLogin } from "@/lib/learning-portal";
import { NextRequest } from "next/server";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) { return startPortalLogin(request.nextUrl.searchParams.get("preview")==="1"?"speaking-preview":"speaking"); }
