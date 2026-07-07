import Link from "next/link";
import { getServerSessionUser } from "@/lib/auth";
import { AdminDashboard } from "@/app/dashboard/AdminDashboard";
import { ApproverDashboard } from "@/app/dashboard/ApproverDashboard";
import { QcSupervisorDashboard } from "@/app/dashboard/QcSupervisorDashboard";
import { ReporterDashboard } from "@/app/dashboard/ReporterDashboard";

export const dynamic = "force-dynamic";

function pickPrimaryRole(roles: string[]) {
  const priority = ["admin", "qc_supervisor", "approver_l2", "approver_l1", "reporter"];
  for (const r of priority) {
    if (roles.includes(r)) return r;
  }
  return "";
}

export default async function HomePage() {
  const user = await getServerSessionUser();
  if (!user) {
    return (
      <div className="grid gap-4">
        <section className="wt-card">
          <div className="wt-card-hd">
            <h1 className="wt-card-title">概览</h1>
          </div>
          <div className="grid gap-3 px-4 py-4">
            <div className="wt-muted">请先登录后查看不同角色的概览数据。</div>
            <div>
              <Link href="/login" className="wt-btn wt-btn-primary">
                去登录
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  const primaryRole = pickPrimaryRole(user.roles);
  if (primaryRole === "admin") return <AdminDashboard />;
  if (primaryRole === "qc_supervisor") return <QcSupervisorDashboard userId={user.id} />;
  if (primaryRole === "approver_l2") return <ApproverDashboard userId={user.id} level={2} />;
  if (primaryRole === "approver_l1") return <ApproverDashboard userId={user.id} level={1} />;
  if (primaryRole === "reporter") return <ReporterDashboard userId={user.id} />;

  return (
    <div className="grid gap-4">
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">概览</h1>
        </div>
        <div className="grid gap-2 px-4 py-4">
          <div className="wt-muted">当前账号没有可识别的角色。</div>
          <div className="wt-muted">roles = {user.roles.join(", ") || "-"}</div>
        </div>
      </section>
    </div>
  );
}
