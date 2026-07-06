import Link from "next/link";
import { getServerSessionUser } from "@/lib/auth";
import { AdminPanel } from "@/app/admin/AdminPanel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await getServerSessionUser();
  if (!user) {
    return (
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">后台配置</h1>
        </div>
        <div className="grid gap-2 px-4 py-4">
          <div className="wt-muted">请先登录。</div>
          <div>
            <Link href="/login" className="wt-btn wt-btn-primary">
              去登录
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!user.roles.includes("admin")) {
    return (
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">后台配置</h1>
        </div>
        <div className="px-4 py-4">
          <div className="wt-muted">当前账号不是管理员。</div>
        </div>
      </section>
    );
  }

  return <AdminPanel />;
}
