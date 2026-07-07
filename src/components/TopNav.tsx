import Link from "next/link";
import { getServerSessionUser, listLoginUsers } from "@/lib/auth";
import { UserMenu } from "@/components/UserMenu";

type NavItem = { href: string; label: string };

const nav: NavItem[] = [
  { href: "/", label: "概览" },
  { href: "/scan", label: "扫描品控" },
  { href: "/tickets", label: "异常工单" },
  { href: "/monitor", label: "接口监控" },
  { href: "/admin", label: "后台配置" },
];

export async function TopNav() {
  const [user, users] = await Promise.all([getServerSessionUser(), listLoginUsers()]);

  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 lg:min-w-0">
          <Link href="/" className="text-base font-semibold tracking-tight">
            运单异常管理 V3
          </Link>
          <nav className="flex flex-wrap items-center gap-4 text-sm">
            {nav.map((it) => (
              <Link key={it.href} href={it.href} className="text-slate-700 hover:text-slate-900">
                {it.label}
              </Link>
            ))}
          </nav>
        </div>
        <UserMenu user={user} users={users} />
      </div>
    </header>
  );
}
