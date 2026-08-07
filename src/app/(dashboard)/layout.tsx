import { AppSidebar } from "@/components/layout/app-sidebar";
import { Topbar } from "@/components/layout/topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { usuarioActual } from "@/lib/mock-data/usuarios";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Topbar user={usuarioActual} />
        <div className="flex-1 space-y-6 p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
