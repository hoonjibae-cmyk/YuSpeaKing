import "server-only";
import { coTaughtClassIds } from "./transfers";
import { couponHelperClassIds } from "./coupon-helpers";

// 내 반이 아닌데도 볼 수 있는 반을 두 갈래로 나눠 둔다.
//
//  manage  : 인수인계 공동 관리 기간 중인 반 — 담임과 똑같이 다룰 수 있다
//  viewOnly: 보조강사로 지정된 반 — 보기만 하고, 바꿀 수 있는 건 쿠폰뿐
//
// DB 쪽 정책(027)이 이미 같은 기준으로 막아 두었지만, 화면에서도 같은 기준을
// 써야 한다. 그러지 않으면 보조강사에게 눌러도 아무 일이 안 일어나는 버튼을
// 보여 주게 된다.
export interface SharedClasses {
  manage: string[];
  viewOnly: string[];
  /** 둘을 합친 목록 (중복 제거) */
  all: string[];
}

export async function sharedClassIds(
  teacherId: string,
): Promise<SharedClasses> {
  const [manage, viewOnly] = await Promise.all([
    coTaughtClassIds(teacherId),
    couponHelperClassIds(teacherId),
  ]);
  // 같은 반에 두 등급이 겹칠 일은 없지만, 겹치면 넓은 쪽(manage)을 따른다
  const onlyView = viewOnly.filter((id) => !manage.includes(id));
  return {
    manage,
    viewOnly: onlyView,
    all: Array.from(new Set([...manage, ...onlyView])),
  };
}

// 한 반에 대한 권한 판정. 담임이면 전부, 공동 관리면 전부, 보조강사면 보기만.
export function accessFor(
  classId: string,
  isOwner: boolean,
  shared: SharedClasses,
): { canView: boolean; canManage: boolean } {
  if (isOwner) return { canView: true, canManage: true };
  if (shared.manage.includes(classId))
    return { canView: true, canManage: true };
  if (shared.viewOnly.includes(classId))
    return { canView: true, canManage: false };
  return { canView: false, canManage: false };
}
