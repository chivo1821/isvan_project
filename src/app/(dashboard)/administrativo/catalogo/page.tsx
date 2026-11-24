import { PageHeader } from "@/components/layout/page-header";
import { ClientesFichas, PreciosListas, ProductosTabla } from "@/components/modules/administrativo/catalogo";
import { SelectorEmpresa } from "@/components/modules/administrativo/comunes";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiGet } from "@/lib/api-client";
import { empresaElegida, type EmpresaFiscal, type ListaPrecio, type Producto, type SearchParams } from "@/lib/administrativo";

export default async function CatalogoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const empresas = await apiGet<EmpresaFiscal[]>("/empresas");
  const empresa = empresaElegida(empresas, await searchParams);
  if (!empresa) return null;
  const [productos, listas] = await Promise.all([
    apiGet<Producto[]>(`/catalogo/productos?empresaId=${empresa.id}`),
    apiGet<ListaPrecio[]>(`/catalogo/listas?empresaId=${empresa.id}`),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Catálogo y precios"
        subtitle="Productos, listas de precio en USD y la ficha fiscal de los clientes. Hasta el corte se completan desde el extracto de ventas."
        actions={<SelectorEmpresa empresas={empresas} actual={empresa.id} />}
      />
      <Tabs defaultValue="productos">
        <TabsList>
          <TabsTrigger value="productos">Productos ({productos.length})</TabsTrigger>
          <TabsTrigger value="precios">Precios</TabsTrigger>
          <TabsTrigger value="clientes">Ficha fiscal</TabsTrigger>
        </TabsList>
        <TabsContent value="productos" className="pt-3"><ProductosTabla empresaId={empresa.id} productos={productos} /></TabsContent>
        <TabsContent value="precios" className="pt-3"><PreciosListas empresaId={empresa.id} listas={listas} /></TabsContent>
        <TabsContent value="clientes" className="pt-3"><ClientesFichas empresaId={empresa.id} /></TabsContent>
      </Tabs>
    </div>
  );
}
