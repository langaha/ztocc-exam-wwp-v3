import { getReporterDashboard } from "@/lib/dashboardService";
import { BreakdownTable, RoleSection, StatCard } from "@/app/dashboard/DashboardWidgets";

export async function ReporterDashboard(props: { userId: string }) {
  const d = await getReporterDashboard(props.userId);
  return (
    <div className="grid gap-4">
      <RoleSection title="上报人概览">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="我上报的未关闭工单" value={d.openCount} href="/tickets" />
          <StatCard label="待我重提" value={d.resubmitCount} href="/tickets?status=REJECTED_NEED_RESUBMIT" />
          <StatCard label="我上报的即将超时(1h)" value={d.dueSoonCount} href="/tickets" />
          <StatCard label="今日我上报" value={d.createdTodayCount} href="/tickets" />
        </div>
      </RoleSection>
      <BreakdownTable title="我上报的工单状态分布" items={d.breakdown} />
    </div>
  );
}

