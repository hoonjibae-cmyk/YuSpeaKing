import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export const LEARNING_PORTAL_ORIGIN = "https://learning.yussam.com";
export type PortalClient = "speaking" | "voca" | "speaking-preview" | "voca-preview";
const origins = { speaking: "https://yuspeaking.yussam.com", voca: "https://voca.yussam.com", "speaking-preview":"https://yuspeaking.yussam.com", "voca-preview":"https://voca.yussam.com" };
function callbackUrl(client: PortalClient) { return origins[client] + "/api/learning-portal/callback" + (client.endsWith("-preview") ? "?preview=1" : ""); }
const txCookie = "learning_portal_transaction";
const random = () => randomBytes(32).toString("base64url");
export function portalEnabled() { return process.env.LEARNING_PORTAL_ENABLED === "true"; }
export function startPortalLogin(client: PortalClient) {
  if (!portalEnabled()) return NextResponse.json({ error: "포탈 연결을 준비 중입니다. 기존 로그인은 그대로 이용해 주세요." }, { status: 503 });
  const state = random(), verifier = random();
  const url = new URL("/oauth/authorize", LEARNING_PORTAL_ORIGIN);
  url.search = new URLSearchParams({ client_id: client, redirect_uri: callbackUrl(client), state, code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
  const response = NextResponse.redirect(url);
  response.cookies.set(txCookie, Buffer.from(JSON.stringify({ state, verifier, created: Date.now() })).toString("base64url"), { httpOnly: true, secure: true, sameSite: "lax", path: "/api/learning-portal", maxAge: 180 });
  response.headers.set("Cache-Control", "no-store");response.headers.set("Referrer-Policy", "no-referrer");return response;
}
export async function exchangePortalCode(request: NextRequest, client: PortalClient): Promise<{ card_id: string | null; is_test: boolean; preview_token?: string; voca_session?: { access_token: string; refresh_token: string } }> {
  if (!portalEnabled()) throw new Error("포탈 연결을 준비 중입니다.");
  let tx: { state: string; verifier: string; created: number };
  try { tx = JSON.parse(Buffer.from(request.cookies.get(txCookie)?.value || "", "base64url").toString()); } catch { throw new Error("로그인 요청이 만료됐습니다."); }
  const state = request.nextUrl.searchParams.get("state"), code = request.nextUrl.searchParams.get("code");
  if (!tx.state || tx.state !== state || !code || Date.now() - tx.created > 180000 || tx.created > Date.now()) throw new Error("로그인 요청을 확인해 주세요.");
  const response = await fetch(LEARNING_PORTAL_ORIGIN + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, client_id: client, code_verifier: tx.verifier, redirect_uri: callbackUrl(client) }), cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error("로그인 코드가 만료됐습니다. 포탈에서 다시 시작해 주세요.");
  const identity = await response.json();
  if (client.endsWith("-preview")) { if (identity.is_test !== true || identity.card_id !== null || identity.audience !== client || typeof identity.preview_token !== "string" || !/^[\w-]{43}$/.test(identity.preview_token)) throw new Error("가상 학생 세션을 확인하지 못했습니다."); return identity; }
  if (identity.is_test !== false || identity.audience !== client || !/^\d+$/.test(identity.card_id || "") || identity.subject !== "card:" + identity.card_id) throw new Error("학생카드 연결이 확인되지 않았습니다.");
  return identity;
}
export function clearPortalTransaction(response: NextResponse) { response.cookies.set(txCookie, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/api/learning-portal", maxAge: 0 }); return response; }
export function setPortalUiCookie(response: NextResponse) { response.cookies.set("maeil_ui","1",{httpOnly:false,secure:true,sameSite:"lax",path:"/",maxAge:43200});return response; }
export function setPreviewCookie(response: NextResponse, token: string) { response.cookies.set("learning_portal_preview",token,{httpOnly:true,secure:true,sameSite:"lax",path:"/learning-portal",maxAge:43200}); return setPortalUiCookie(clearPortalTransaction(response)); }
export async function getPortalPreview(client: "speaking-preview" | "voca-preview") {
 if (!portalEnabled()) return null;
 const value=(await cookies()).get("learning_portal_preview")?.value;if(!value)return null;
 const response=await fetch(LEARNING_PORTAL_ORIGIN+"/oauth/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:value,client_id:client}),cache:"no-store",signal:AbortSignal.timeout(10000)});
 if(!response.ok)return null;const identity=await response.json();if(identity.is_test!==true||identity.card_id!==null||identity.audience!==client)return null;
 return {token:value,name:String(identity.name||"가상 테스트 학생")};
}
