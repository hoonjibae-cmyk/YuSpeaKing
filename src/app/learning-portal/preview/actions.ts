"use server";
import { getPortalPreview,LEARNING_PORTAL_ORIGIN } from "@/lib/learning-portal";
export async function completePreviewAction(){const identity=await getPortalPreview("speaking-preview");if(!identity)throw new Error("포탈에서 다시 시작해 주세요.");const r=await fetch(LEARNING_PORTAL_ORIGIN+"/oauth/preview-event",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:identity.token,client_id:"speaking-preview"}),cache:"no-store",signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error("가상 연습 기록을 저장하지 못했습니다.");}
