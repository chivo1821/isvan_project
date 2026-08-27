"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExcelImportPanel } from "./excel-import-panel";
import { ManualDespachoForm } from "./manual-despacho-form";
import type { Almacen, Cliente } from "@/lib/mock-data";

export function NuevoDespachoWizard({
  clientes,
  origen,
  creadoPorId,
}: {
  clientes: Cliente[];
  origen: Almacen;
  creadoPorId: string;
}) {
  return (
    <Tabs defaultValue="excel" className="gap-4">
      <TabsList>
        <TabsTrigger value="excel">Importar Excel</TabsTrigger>
        <TabsTrigger value="manual">Carga manual</TabsTrigger>
      </TabsList>
      <TabsContent value="excel">
        <ExcelImportPanel origen={origen} creadoPorId={creadoPorId} />
      </TabsContent>
      <TabsContent value="manual">
        <ManualDespachoForm clientes={clientes} origen={origen} creadoPorId={creadoPorId} />
      </TabsContent>
    </Tabs>
  );
}
