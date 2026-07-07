"use client";

import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { LoginUserOption, SessionUser } from "@/lib/auth";

export function UserMenu(props: {
  user: SessionUser | null;
  users: LoginUserOption[];
  compact?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const enabledUsers = useMemo(() => props.users.filter((u) => u.enabled), [props.users]);
  const [userId, setUserId] = useState(props.user?.id ?? enabledUsers[0]?.id ?? "");
  const [loading, setLoading] = useState<"" | "switch" | "logout">("");
  const [msg, setMsg] = useState("");

  const currentRoles = props.user?.roles.join(", ") ?? "";

  async function switchAccount() {
    if (!userId) return;
    setLoading("switch");
    setMsg("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (!res.ok) {
        setMsg(String(json?.error ?? "切换账号失败"));
        return;
      }
      router.refresh();
      router.push(pathname || "/");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "切换账号失败");
    } finally {
      setLoading("");
    }
  }

  async function logout() {
    setLoading("logout");
    setMsg("");
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (error) {
      setMsg(error instanceof Error ? error.message : "退出失败");
    } finally {
      setLoading("");
    }
  }

  if (!props.user) {
    return (
      <div className="flex items-center gap-2">
        <a href="/login" className={props.compact ? "wt-btn wt-btn-ghost text-white hover:bg-white/10" : "wt-btn"}>
          去登录
        </a>
      </div>
    );
  }

  return (
    <details className="relative">
      <summary
        className={
          props.compact
            ? "wt-btn wt-btn-ghost cursor-pointer list-none text-white hover:bg-white/10"
            : "wt-btn cursor-pointer list-none"
        }
      >
        <span className="inline-flex items-center gap-2">
          <span className={props.compact ? "text-sm font-medium" : "text-sm font-medium"}>{props.user.name}</span>
          <span className={props.compact ? "text-xs text-white/80" : "text-xs text-ink-500"}>{currentRoles || "无角色"}</span>
        </span>
      </summary>
      <div className="absolute right-0 z-20 mt-2 w-[340px] rounded-xl border border-slate-200/70 bg-white shadow-card">
        <div className="grid gap-2 px-4 py-3">
          <div className="text-sm font-medium text-ink-900">切换账号</div>
          <select className="wt-select w-full" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {enabledUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{u.roles.join(",")}）
              </option>
            ))}
          </select>
          <div className="flex items-center justify-end gap-2">
            <button className="wt-btn" disabled={!userId || loading !== ""} onClick={switchAccount}>
              {loading === "switch" ? "切换中…" : "切换"}
            </button>
            <button className="wt-btn wt-btn-ghost" disabled={loading !== ""} onClick={logout}>
              {loading === "logout" ? "退出中…" : "退出登录"}
            </button>
          </div>
          {msg ? <div className="text-xs text-rose-600">{msg}</div> : null}
        </div>
      </div>
    </details>
  );
}
