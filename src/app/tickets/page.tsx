import Link from "next/link";
import { getServerSessionUser } from "@/lib/auth";
import { listTickets } from "@/lib/ticketService";
import { TicketsClient } from "@/app/tickets/TicketsClient";

export const dynamic = "force-dynamic";

function toPositiveInt(v: string | undefined, fallback: number, max: number) {
  const n = Number(String(v ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

export default async function TicketsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await getServerSessionUser();
  if (!currentUser) {
    return (
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">异常工单</h1>
        </div>
        <div className="grid gap-2 px-4 py-4">
          <div className="wt-muted">请先登录后再操作工单。</div>
          <div>
            <Link href="/login" className="wt-btn wt-btn-primary">
              去登录
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const searchParams = props.searchParams ? await props.searchParams : {};
  const status = typeof searchParams.status === "string" ? searchParams.status : "";
  const type = typeof searchParams.type === "string" ? searchParams.type : "";
  const externalCode = typeof searchParams.externalCode === "string" ? searchParams.externalCode : "";
  const assignedToMe = typeof searchParams.assignedToMe === "string" ? searchParams.assignedToMe : "";
  const page = toPositiveInt(typeof searchParams.page === "string" ? searchParams.page : undefined, 1, 100000);
  const pageSize = toPositiveInt(typeof searchParams.pageSize === "string" ? searchParams.pageSize : undefined, 20, 100);

  const data = await listTickets({
    status: status || undefined,
    type: type || undefined,
    externalCode: externalCode || undefined,
    assignedUserId: assignedToMe === "1" ? currentUser.id : undefined,
    page,
    pageSize,
  });

  return (
    <div className="grid gap-4">
      <section className="wt-card">
        <div className="wt-card-hd">
          <h2 className="wt-card-title">筛选</h2>
        </div>
        <form className="grid gap-3 px-4 py-4 md:grid-cols-5" method="GET">
          <input className="wt-input" name="externalCode" placeholder="运单号" defaultValue={externalCode} />
          <select className="wt-select" name="type" defaultValue={type}>
            <option value="">全部类型</option>
            <option value="QC">QC</option>
            <option value="LOGISTICS">LOGISTICS</option>
          </select>
          <select className="wt-select" name="status" defaultValue={status}>
            <option value="">全部状态</option>
            <option value="L1_APPROVING">L1_APPROVING</option>
            <option value="L2_APPROVING">L2_APPROVING</option>
            <option value="REJECTED_NEED_RESUBMIT">REJECTED_NEED_RESUBMIT</option>
            <option value="DONE">DONE</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input type="checkbox" name="assignedToMe" value="1" defaultChecked={assignedToMe === "1"} />
            只看分配给我
          </label>
          <div className="flex gap-2">
            <button className="wt-btn wt-btn-primary" type="submit">
              筛选
            </button>
            <Link href="/tickets" className="wt-btn">
              重置
            </Link>
          </div>
        </form>
      </section>

      <TicketsClient
        currentUser={{ id: currentUser.id, name: currentUser.name, roles: currentUser.roles }}
        tickets={data.list}
        total={data.total}
        page={page}
        pageSize={pageSize}
      />
    </div>
  );
}
