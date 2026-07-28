"use client";

import { useEffect } from "react";
import { markNoticesRead } from "@/app/student/actions";

// 공지 목록 화면을 열면 안 읽은 공지를 읽음 처리한다.
export default function NoticeReadMarker({ noticeIds }: { noticeIds: string[] }) {
  useEffect(() => {
    if (noticeIds.length === 0) return;
    markNoticesRead(noticeIds).catch(() => {});
  }, [noticeIds]);
  return null;
}
