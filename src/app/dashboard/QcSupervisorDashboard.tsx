import { getQcSupervisorDashboard } from "@/lib/dashboardService";
import { BreakdownTable, RoleSection, StatCard } from "@/app/dashboard/DashboardWidgets";

export async function QcSupervisorDashboard(props: { userId: string }) {
  const d = await getQcSupervisorDashboard(props.userId);
  return (
    <div className="grid gap-4">
      <RoleSection title="品控主管概览">
        <div className="grid gap-3 md:grid-cols-5">
          <StatCard label="暂扣批次(关联工单)" value={d.linkedTicketBatches} href="/scan" />
          <StatCard label="暂扣即将超时(10m)" value={d.holdDueSoonBatches} href="/scan" />
          <StatCard label="暂扣已超时" value={d.holdOverdueBatches} href="/scan" />
          <StatCard label="未关闭品控工单" value={d.qcOpenTickets} href="/tickets?type=QC" />
          <StatCard label="今日快速放行" value={d.fastReleaseTodayCount} href="/tickets?type=QC" />
        </div>
      </RoleSection>
      <BreakdownTable title="品控工单状态分布" items={d.breakdown} />
    </div>
  );
}

