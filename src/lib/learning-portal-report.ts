import "server-only";
export async function verifyPortalIdentity(authorization:string|null):Promise<{userId:string;cardId:string|null;isTest:boolean}>{
 if(!authorization?.startsWith('Bearer ')||authorization.length>8192)throw Error('학생 로그인이 필요합니다.');
 const response=await fetch('https://voca.yussam.com/api/learning-portal/student-account?status=1',{headers:{authorization},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('현재 사용 가능한 학생 계정이 아닙니다.');
 const identity=await response.json();if(identity.active!==true||!identity.userId)throw Error('학생 계정을 확인해 주세요.');
 return {userId:identity.userId,cardId:identity.cardId,isTest:identity.isTest};
}
export async function verifyPortalStudent(authorization:string|null):Promise<string>{const identity=await verifyPortalIdentity(authorization);if(!identity.cardId)throw new Error("학생카드 연결 계정이 아닙니다.");return identity.cardId;}
export function portalWeek(value: string | null) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error("주간 시작일을 확인해 주세요.");
 const date = new Date(value + "T00:00:00+09:00");
 if (Number.isNaN(date.getTime()) || new Date(date.getTime() + 32400000).toISOString().slice(0, 10) !== value || new Date(date.getTime() + 32400000).getUTCDay() !== 1) throw new Error("월요일을 시작일로 지정해 주세요.");
 return { from: date.toISOString(), to: new Date(date.getTime() + 604800000).toISOString() };
}
