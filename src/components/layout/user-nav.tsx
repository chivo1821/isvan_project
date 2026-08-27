"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOutIcon, UserIcon } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CambiarPasswordDialog } from "@/components/modules/auth/cambiar-password-dialog";
import { ROL_USUARIO_META } from "@/lib/constants";
import type { RolUsuario } from "@prisma/client";

export function UserNav({
  user,
}: {
  user: { id: string; nombre: string; email: string; rol: RolUsuario; avatarUrl?: string | null };
}) {
  const router = useRouter();
  const [cambiandoPassword, setCambiandoPassword] = useState(false);

  const iniciales = user.nombre
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  async function cerrarSesion() {
    try {
      await apiPost("/auth/logout");
    } catch {
      // aunque falle en el servidor, igual mandamos al login
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted"
          >
            <Avatar>
              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.nombre} />}
              <AvatarFallback>{iniciales}</AvatarFallback>
            </Avatar>
            <span className="hidden flex-col sm:flex">
              <span className="text-sm font-medium text-foreground">{user.nombre}</span>
              <span className="text-xs text-muted-foreground">{ROL_USUARIO_META[user.rol].label}</span>
            </span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="flex flex-col">
              <span className="font-medium">{user.nombre}</span>
              <span className="text-xs font-normal text-muted-foreground">{user.email}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCambiandoPassword(true)}>
            <UserIcon />
            Cambiar contraseña
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={cerrarSesion}>
            <LogOutIcon />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CambiarPasswordDialog usuarioId={user.id} open={cambiandoPassword} onOpenChange={setCambiandoPassword} />
    </>
  );
}
