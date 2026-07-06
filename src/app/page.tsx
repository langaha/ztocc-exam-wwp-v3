export default function HomePage() {
  return (
    <div className="grid gap-4">
      <section className="wt-card">
        <div className="wt-card-hd">
          <h1 className="wt-card-title">概览</h1>
        </div>
        <div className="px-4 py-4">
          <div className="wt-muted">
            先完成文档约束下的基础设施（V2 桥接接口、V3 表结构、鉴权、V2 调用日志与快照），再落地扫描品控与工单审批流程。
          </div>
        </div>
      </section>
    </div>
  );
}

