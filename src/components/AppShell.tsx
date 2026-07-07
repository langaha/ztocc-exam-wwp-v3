import { SideNav } from "@/components/SideNav";
import { TopBar } from "@/components/TopBar";

export function AppShell(props: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <SideNav />
        <main className="flex-1 overflow-auto bg-canvas-50">
          <div className="mx-auto w-full max-w-6xl px-4 py-6">{props.children}</div>
        </main>
      </div>
    </div>
  );
}
