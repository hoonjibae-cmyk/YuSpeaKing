"use client";

import { useEffect, useState } from "react";

// base64url(VAPID 공개키) → Uint8Array
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return buf;
}

type State = "loading" | "unsupported" | "ios-needs-install" | "off" | "on" | "denied";

// 학생이 휴대폰 푸시 알림을 켜고 끄는 버튼.
export default function PushToggle({ vapidKey }: { vapidKey: string }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!vapidKey) return setState("unsupported");

    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    if (!supported) {
      // iOS 는 홈 화면에 추가(standalone)해야만 푸시를 지원한다
      const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // @ts-expect-error iOS Safari 전용 속성
        window.navigator.standalone === true;
      return setState(isIOS && !standalone ? "ios-needs-install" : "unsupported");
    }

    if (Notification.permission === "denied") return setState("denied");

    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("unsupported"));
  }, [vapidKey]);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setState(res.ok ? "on" : "off");
    } catch {
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      /* 무시 */
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading" || state === "unsupported") return null;

  if (state === "ios-needs-install") {
    return (
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        📱 아이폰에서 공지 알림을 받으려면, 사파리 아래 <b>공유 버튼</b> →{" "}
        <b>홈 화면에 추가</b> 를 한 뒤 홈 화면 아이콘으로 다시 들어와 주세요.
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
        🔕 알림이 차단되어 있어요. 브라우저 주소창 옆 자물쇠 → 알림을{" "}
        <b>허용</b>으로 바꾸면 공지 알림을 받을 수 있어요.
      </p>
    );
  }

  return (
    <button
      onClick={state === "on" ? disable : enable}
      disabled={busy}
      className={`mt-3 w-full rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
        state === "on"
          ? "border-slate-300 bg-white text-slate-500 hover:bg-slate-50"
          : "border-brand bg-brand-light text-brand hover:bg-blue-100"
      }`}
    >
      {busy
        ? "처리 중…"
        : state === "on"
          ? "🔔 공지 알림 켜짐 (끄기)"
          : "🔔 공지 알림 받기"}
    </button>
  );
}
