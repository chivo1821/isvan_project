"use client";

import { useState } from "react";
import { ClientesTable } from "@/components/modules/clientes/clientes-table";
import { CensosPorCorregir } from "@/components/modules/clientes/censos-por-corregir";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ConteoCorreccion } from "@/lib/censo";
import { formatNumero } from "@/lib/constants";
import type { Cliente } from "@/lib/mock-data";

/** Clientes y, para quien los crea, los censos que no pudieron crear su
 * cliente (pestaña aparte, con el número de pendientes). */
export function ClientesVistas({
  clientes,
  puedeCrear,
  conteoCensos,
  esAdmin,
}: {
  clientes: Cliente[];
  puedeCrear: boolean;
  conteoCensos: ConteoCorreccion | null;
  esAdmin: boolean;
}) {
  const [conteo, setConteo] = useState(conteoCensos);
  if (!conteo) return <ClientesTable clientes={clientes} puedeCrear={puedeCrear} />;
  const pendientes = Object.values(conteo).reduce((s, n) => s + n, 0);

  return (
    <Tabs defaultValue="clientes">
      <TabsList>
        <TabsTrigger value="clientes">Clientes</TabsTrigger>
        <TabsTrigger value="censos">
          Censos por corregir
          {pendientes > 0 && (
            <span className="ml-1 rounded-full bg-warning/25 px-1.5 text-xs tabular-nums text-foreground">
              {formatNumero(pendientes)}
            </span>
          )}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="clientes" className="mt-4">
        <ClientesTable clientes={clientes} puedeCrear={puedeCrear} />
      </TabsContent>
      <TabsContent value="censos" className="mt-4">
        <CensosPorCorregir conteoInicial={conteo} esAdmin={esAdmin} onConteo={setConteo} />
      </TabsContent>
    </Tabs>
  );
}
