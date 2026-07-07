import { LoginForm } from "@/app/login/LoginForm";
import { listLoginUsers } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const users = await listLoginUsers();
  return <LoginForm users={users} />;
}
