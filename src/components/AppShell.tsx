import { TopNav } from "@/components/TopNav";

export function AppShell(props: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopNav />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-6xl px-4 py-6">{props.children}</div>
      </main>
    </div>
  );
}

