"use client";

import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROL_USUARIO_META } from "@/lib/constants";
import type { RolUsuario } from "@prisma/client";

export function UserNav({
  user,
}: {
  user: { nombre: string; email: string; rol: RolUsuario; avatarUrl?: string | null };
}) {
  const iniciales = user.nombre
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
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
        <DropdownMenuItem>
          <UserIcon />
          Mi perfil
        </DropdownMenuItem>
        <DropdownMenuItem>
          <SettingsIcon />
          Configuración
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          <LogOutIcon />
          Cerrar sesión
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
