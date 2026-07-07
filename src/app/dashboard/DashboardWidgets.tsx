import Link from "next/link";

export function StatCard(props: { label: string; value: string | number; href?: string }) {
  const body = (
    <div className="wt-card">
      <div className="px-4 py-4">
        <div className="text-sm text-ink-500">{props.label}</div>
        <div className="mt-1 text-2xl font-semibold text-ink-900">{props.value}</div>
      </div>
    </div>
  );
  return props.href ? (
    <Link href={props.href} className="block transition-transform hover:-translate-y-[1px]">
      {body}
    </Link>
  ) : (
    body
  );
}

export function BreakdownTable(props: { items: Array<{ status: string; count: number }>; title: string }) {
  return (
    <section className="wt-card">
      <div className="wt-card-hd">
        <h2 className="wt-card-title">{props.title}</h2>
      </div>
      <div className="overflow-auto">
        <table className="wt-table">
          <thead>
            <tr>
              <th className="wt-th">状态</th>
              <th className="wt-th">数量</th>
            </tr>
          </thead>
          <tbody>
            {props.items.map((it) => (
              <tr key={it.status}>
                <td className="wt-td">{it.status}</td>
                <td className="wt-td">{it.count}</td>
              </tr>
            ))}
            {props.items.length === 0 ? (
              <tr>
                <td className="wt-td" colSpan={2}>
                  暂无数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RoleSection(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="wt-card">
      <div className="wt-card-hd">
        <h1 className="wt-card-title">{props.title}</h1>
      </div>
      <div className="px-4 py-4">{props.children}</div>
    </section>
  );
}

