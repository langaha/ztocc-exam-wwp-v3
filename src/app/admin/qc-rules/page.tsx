import Link from "next/link";
import { getServerSessionUser } from "@/lib/auth";
import { listQcRules } from "@/lib/qcRuleService";
import { QcRulesClient } from "@/app/admin/qc-rules/QcRulesClient";

export const dynamic = "force-dynamic";

export default async function QcRulesPage() {
  const user = await getServerSessionUser();
  if (!user) {
    return (
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">品控规则管理</h1>
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
          <h1 className="wt-card-title">品控规则管理</h1>
        </div>
        <div className="grid gap-2 px-4 py-4">
          <div className="wt-muted">当前账号不是管理员。</div>
          <div>
            <Link href="/admin" className="wt-btn">
              返回后台
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const initialRules = await listQcRules();
  return <QcRulesClient initialRules={initialRules} />;
}

