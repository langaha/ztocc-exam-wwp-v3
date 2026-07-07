import { getAdminDashboard } from "@/lib/dashboardService";
import { BreakdownTable, RoleSection, StatCard } from "@/app/dashboard/DashboardWidgets";

export async function AdminDashboard() {
  const d = await getAdminDashboard();
  const successRate = d.apiLastHourAgg.total > 0 ? Math.round((d.apiLastHourAgg.ok / d.apiLastHourAgg.total) * 100) : 0;

  return (
    <div className="grid gap-4">
      <RoleSection title="管理员概览">
        <div className="grid gap-3 md:grid-cols-5">
          <StatCard label="工单总数" value={d.totalTickets} href="/tickets" />
          <StatCard label="未关闭工单" value={d.openTickets} href="/tickets" />
          <StatCard label="即将超时(1h)" value={d.dueSoonTickets} href="/tickets" />
          <StatCard label="暂扣批次(关联工单)" value={d.qcHoldBatches} href="/scan" />
          <StatCard label="今日审批记录" value={d.approvalsToday} href="/tickets" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <StatCard label="近1小时接口调用次数" value={d.apiLastHourAgg.total} href="/monitor" />
          <StatCard label="近1小时成功率" value={`${successRate}%`} href="/monitor" />
          <StatCard label="近1小时失败次数" value={d.apiLastHourAgg.fail} href="/monitor" />
        </div>
        <div className="mt-4 wt-muted">
          最新接口调用：{d.apiLatest ? `${d.apiLatest.apiName} / ${d.apiLatest.responseStatus ?? "-"} / ${d.apiLatest.ok ? "OK" : "FAIL"}` : "暂无"}
        </div>
      </RoleSection>
      <BreakdownTable title="未关闭工单状态分布" items={d.breakdownOpen} />
    </div>
  );
}

