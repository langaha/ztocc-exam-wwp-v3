import { getApproverDashboard } from "@/lib/dashboardService";
import { BreakdownTable, RoleSection, StatCard } from "@/app/dashboard/DashboardWidgets";

export async function ApproverDashboard(props: { userId: string; level: 1 | 2 }) {
  const d = await getApproverDashboard(props.level, props.userId);
  const title = props.level === 1 ? "一级审批概览" : "二级审批概览";
  const pendingLabel = props.level === 1 ? "待我审批(L1)" : "待我审批(L2)";

  return (
    <div className="grid gap-4">
      <RoleSection title={title}>
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label={pendingLabel} value={d.pendingCount} href="/tickets?assignedToMe=1" />
          <StatCard label="即将超时(1h)" value={d.dueSoonCount} href="/tickets?assignedToMe=1" />
          <StatCard label="今日已处理" value={d.processedTodayCount} href="/tickets?assignedToMe=1" />
          <StatCard label="我的工单(全部状态)" value={d.breakdown.reduce((s, x) => s + x.count, 0)} href="/tickets?assignedToMe=1" />
        </div>
      </RoleSection>
      <BreakdownTable title="我关联的工单状态分布" items={d.breakdown} />
    </div>
  );
}

