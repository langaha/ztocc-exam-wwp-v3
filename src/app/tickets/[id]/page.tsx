import Link from "next/link";
import { getServerSessionUser } from "@/lib/auth";
import { getTicketDetail } from "@/lib/ticketService";
import { TicketDetailClient } from "@/app/tickets/[id]/TicketDetailClient";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await getServerSessionUser();
  if (!user) {
    return (
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">工单详情</h1>
        </div>
        <div className="grid gap-2 px-4 py-4">
          <div className="wt-muted">请先登录后查看工单详情。</div>
          <div>
            <Link href="/login" className="wt-btn wt-btn-primary">
              去登录
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const { id } = await props.params;
  const detail = await getTicketDetail(id);
  if (!detail) {
    return (
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">工单详情</h1>
        </div>
        <div className="grid gap-2 px-4 py-4">
          <div className="wt-muted">工单不存在。</div>
          <div>
            <Link href="/tickets" className="wt-btn">
              返回列表
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <TicketDetailClient
      currentUser={{ id: user.id, name: user.name, roles: user.roles }}
      ticket={detail.ticket}
      snapshot={detail.snapshot}
      approvals={detail.approvals}
    />
  );
}

