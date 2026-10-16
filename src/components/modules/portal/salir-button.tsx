"use client";

import { useState } from "react";
import { LogOutIcon } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { Button } from "@/components/ui/button";

export function SalirButton() {
  const [saliendo, setSaliendo] = useState(false);

  async function salir() {
    setSaliendo(true);
    try {
      await apiPost("/portal/auth/logout");
    } finally {
      window.location.assign("/portal/ingresar");
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={salir} disabled={saliendo}>
      <LogOutIcon aria-hidden />
      Salir
    </Button>
  );
}
