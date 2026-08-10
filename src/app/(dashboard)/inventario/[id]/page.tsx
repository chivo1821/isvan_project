import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { CATEGORIA_PRODUCTO_META, formatDualCurrency } from "@/lib/constants";
import { getAlmacenesRaw, getProductoById, getStockByProducto } from "@/lib/mock-data";

export default async function ProductoDetallePage({ params }: PageProps<"/inventario/[id]">) {
  const { id } = await params;
  const producto = await getProductoById(id);
  if (!producto) notFound();

  const [stocks, almacenes] = await Promise.all([getStockByProducto(producto.id), getAlmacenesRaw()]);
  const stockTotal = stocks.reduce((sum, s) => sum + s.cantidad, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title={producto.nombre}
        subtitle={`SKU ${producto.sku}`}
        actions={<StatusBadge {...CATEGORIA_PRODUCTO_META[producto.categoria]} />}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Atributos</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Attr label="Subcategoría" value={producto.subcategoria ?? "—"} />
            <Attr label="Unidad de medida" value={producto.unidadMedida} />
            <Attr label="Precio unitario" value={formatDualCurrency(producto.precioUnitario)} />
            <Attr
              label="Cadena de frío"
              value={
                producto.requiereCadenaFrio
                  ? `Requerida (${producto.temperaturaMinC}°C a ${producto.temperaturaMaxC}°C)`
                  : "No requerida"
              }
            />
            <Attr label="Stock total" value={`${stockTotal.toLocaleString("es-VE")} ${producto.unidadMedida}`} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Stock por almacén</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {stocks.map((s) => {
              const almacen = almacenes.find((a) => a.id === s.almacenId);
              const porcentaje = Math.min(100, Math.round((s.cantidad / (s.stockMinimo * 2)) * 100));
              const bajo = s.cantidad < s.stockMinimo;
              return (
                <div key={s.id} className="space-y-1.5">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{almacen?.nombre}</span>
                    <span className={bajo ? "text-warning" : "text-muted-foreground"}>
                      {s.cantidad.toLocaleString("es-VE")} / min. {s.stockMinimo.toLocaleString("es-VE")}
                    </span>
                  </div>
                  <Progress value={porcentaje} className={bajo ? "[&>div]:bg-warning" : undefined} />
                </div>
              );
            })}
            {stocks.length === 0 && (
              <p className="text-sm text-muted-foreground">Este producto no tiene stock registrado.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Attr({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2 last:border-0 last:pb-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  );
}
