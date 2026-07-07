import Link from "next/link";
import { getServerSessionUser, listLoginUsers } from "@/lib/auth";
import { UserMenu } from "@/components/UserMenu";

export async function TopBar() {
  const [user, users] = await Promise.all([getServerSessionUser(), listLoginUsers()]);

  return (
    <header className="wt-topbar">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm font-semibold tracking-tight text-white">
            运单异常管理 V3
          </Link>
          <div className="hidden text-xs text-white/80 md:block">录单 → 扫描品控 → 异常上报 → 分级审批 → 执行联动</div>
        </div>
        <UserMenu user={user} users={users} compact />
      </div>
    </header>
  );
}

