import Link from "next/link";

type NavItem = { href: string; label: string };

const nav: NavItem[] = [
  { href: "/", label: "概览" },
  { href: "/scan", label: "扫描品控" },
  { href: "/tickets", label: "异常工单" },
  { href: "/monitor", label: "接口监控" },
  { href: "/admin", label: "后台配置" },
];

export function TopNav() {
  return (
    <header className="border-b bg-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-base font-semibold tracking-tight">
          运单异常管理 V3
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {nav.map((it) => (
            <Link key={it.href} href={it.href} className="text-slate-700 hover:text-slate-900">
              {it.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

