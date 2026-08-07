import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORIA_PRODUCTO_META, formatDualCurrency } from "@/lib/constants";
import { getStockTotalByProducto, productos } from "@/lib/mock-data";
import type { CategoriaProducto } from "@prisma/client";

type Grupo = {
  categoria: CategoriaProducto;
  subcategoria: string;
  cantidadProductos: number;
  stockTotal: number;
  valorInventario: number;
};

export default function CategoriasPage() {
  const grupos = new Map<string, Grupo>();

  for (const producto of productos) {
    const key = `${producto.categoria}::${producto.subcategoria ?? "Otros"}`;
    const stockTotal = getStockTotalByProducto(producto.id);
    const existente = grupos.get(key);
    if (existente) {
      existente.cantidadProductos += 1;
      existente.stockTotal += stockTotal;
      existente.valorInventario += stockTotal * producto.precioUnitario;
    } else {
      grupos.set(key, {
        categoria: producto.categoria,
        subcategoria: producto.subcategoria ?? "Otros",
        cantidadProductos: 1,
        stockTotal,
        valorInventario: stockTotal * producto.precioUnitario,
      });
    }
  }

  const gruposOrdenados = Array.from(grupos.values()).sort((a, b) => a.categoria.localeCompare(b.categoria));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario por categorías"
        subtitle="Desglose de productos agrupados por categoría y subcategoría"
      />
      <Link href="/inventario" className="inline-block text-sm text-primary hover:underline">
        ← Volver al inventario
      </Link>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {gruposOrdenados.map((grupo) => (
          <Card key={`${grupo.categoria}-${grupo.subcategoria}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{grupo.subcategoria}</CardTitle>
                <span className="text-xs font-medium text-muted-foreground">
                  {CATEGORIA_PRODUCTO_META[grupo.categoria].label}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                {grupo.cantidadProductos} producto{grupo.cantidadProductos !== 1 && "s"}
              </p>
              <p className="text-2xl font-bold text-foreground">{grupo.stockTotal.toLocaleString("es-VE")}</p>
              <p className="text-xs text-muted-foreground">unidades en stock</p>
              <p className="pt-2 text-sm font-medium text-foreground">Valor en inventario:</p>
              <p className="text-sm text-muted-foreground">{formatDualCurrency(grupo.valorInventario)}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
