import Link from "next/link";
import { LayoutGridIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { ProductosTable, type ProductoConStock } from "@/components/modules/inventario/productos-table";
import { getStockTotalByProducto, productoTieneStockBajo, productos } from "@/lib/mock-data";

export default function InventarioPage() {
  const productosConStock: ProductoConStock[] = productos.map((p) => ({
    ...p,
    stockTotal: getStockTotalByProducto(p.id),
    stockBajo: productoTieneStockBajo(p.id),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventario"
        subtitle="Catálogo de productos y niveles de stock por almacén"
        helpText="El inventario se consolida entre todos los centros de acopio. Un producto aparece en 'Stock bajo' si en al menos un almacén su cantidad está por debajo del mínimo definido."
        actions={
          <Button variant="outline" asChild>
            <Link href="/inventario/categorias">
              <LayoutGridIcon />
              Ver por categorías
            </Link>
          </Button>
        }
      />
      <ProductosTable productos={productosConStock} />
    </div>
  );
}
