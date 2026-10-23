import { redirect } from "next/navigation";
import { currentStaff } from "@/lib/auth";
import { Shell } from "@/components/Shell";
import { ToastProvider } from "@/components/Toaster";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentStaff();
  if (!user) redirect("/login");
  return (
    <ToastProvider>
      <Shell user={user}>{children}</Shell>
    </ToastProvider>
  );
}
