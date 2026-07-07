"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

const nav: NavItem[] = [
  { href: "/", label: "概览" },
  { href: "/scan", label: "扫描品控" },
  { href: "/tickets", label: "异常工单" },
  { href: "/monitor", label: "接口监控" },
  { href: "/admin", label: "后台配置" },
];

export function SideNav() {
  const pathname = usePathname();
  return (
    <aside className="wt-sidenav">
      <nav className="grid gap-1 p-3">
        {nav.map((it) => {
          const active = pathname === it.href || (it.href !== "/" && pathname.startsWith(it.href + "/"));
          return (
            <Link key={it.href} href={it.href} className={active ? "wt-sidenav-item wt-sidenav-item-active" : "wt-sidenav-item"}>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

