import { startPortalLogin } from "@/lib/learning-portal";
import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
export function GET(request: NextRequest) { try{return startPortalLogin(request.nextUrl.searchParams.get("preview")==="1"?"speaking-preview":"speaking",request.nextUrl.searchParams.get("target"));}catch{return NextResponse.json({error:"허용되지 않은 과제 주소입니다."},{status:400});} }
