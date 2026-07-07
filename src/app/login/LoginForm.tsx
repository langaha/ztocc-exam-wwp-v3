"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LoginUserOption } from "@/lib/auth";

export function LoginForm(props: { users: LoginUserOption[] }) {
  const router = useRouter();
  const enabledUsers = useMemo(() => props.users.filter((u) => u.enabled), [props.users]);
  const [userId, setUserId] = useState(enabledUsers[0]?.id ?? "");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  return (
    <section className="wt-card">
      <div className="wt-card-hd">
        <h1 className="wt-card-title">登录</h1>
      </div>
      <div className="grid gap-3 px-4 py-4">
        <label className="grid gap-1">
          <span className="text-sm text-ink-700">选择账号</span>
          <select className="wt-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {enabledUsers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}（{u.roles.join(",")}）
              </option>
            ))}
          </select>
        </label>

        {msg ? <div className="text-sm text-rose-600">{msg}</div> : null}

        <div className="flex items-center gap-2">
          <button
            className="wt-btn wt-btn-primary"
            disabled={!userId || loading}
            onClick={async () => {
              setLoading(true);
              setMsg("");
              try {
                const res = await fetch("/api/auth/login", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ userId }),
                });
                if (!res.ok) {
                  const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
                  setMsg(String(j?.error ?? "登录失败"));
                  return;
                }
                router.push("/");
                router.refresh();
              } catch (e) {
                setMsg(e instanceof Error ? e.message : "登录失败");
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? "登录中…" : "登录"}
          </button>
        </div>
      </div>
    </section>
  );
}
