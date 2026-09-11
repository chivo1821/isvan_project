import type { ReactNode } from "react";
import { AlertTriangleIcon, CheckCircle2Icon, InfoIcon } from "lucide-react";
import { formatNumero, formatPct, formatUsd } from "@/lib/constants";
import { formatFecha, type ResumenValidacion as Resumen } from "@/lib/indicadores";
import { cn } from "@/lib/utils";

type Nivel = "ok" | "aviso" | "info";

function Chequeo({ nivel, titulo, children }: { nivel: Nivel; titulo: ReactNode; children?: ReactNode }) {
  const Icono = nivel === "ok" ? CheckCircle2Icon : nivel === "aviso" ? AlertTriangleIcon : InfoIcon;
  return (
    <li
      className={cn(
        "flex gap-2.5 rounded-lg border p-3",
        nivel === "aviso" ? "border-warning/40 bg-warning/5" : "border-border"
      )}
    >
      <Icono
        className={cn(
          "mt-0.5 size-4 shrink-0",
          nivel === "ok" && "text-success",
          nivel === "aviso" && "text-warning",
          nivel === "info" && "text-info"
        )}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">{titulo}</p>
        {children && <div className="space-y-1 text-xs text-muted-foreground">{children}</div>}
      </div>
    </li>
  );
}

function Dato({ label, valor, detalle }: { label: string; valor: string; detalle?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-semibold text-foreground tabular-nums">{valor}</p>
      {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

function listaCorta(items: string[], maximo = 8) {
  return items.length <= maximo ? items.join(", ") : `${items.slice(0, maximo).join(", ")} y ${items.length - maximo} más`;
}

/** Lo que el ADMIN tiene que ver antes de que un archivo cuente en los
 * indicadores (§6 del documento del cliente). */
export function ResumenValidacion({ resumen: r }: { resumen: Resumen }) {
  const t = r.totales;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-4">
        <Dato label="Período" valor={`${formatFecha(r.periodoDesde)} – ${formatFecha(r.periodoHasta)}`} />
        <Dato
          label="Filas leídas"
          valor={formatNumero(r.filasLeidas)}
          detalle={`${formatNumero(r.filasVenta)} de venta · ${formatNumero(r.filasDevolucion)} de devolución`}
        />
        <Dato label="Venta neta" valor={formatUsd(t.ventaNeta, 2)} detalle={`Bs ${formatNumero(t.ventaNetaBs, 2)}`} />
        <Dato label="Litros" valor={formatNumero(t.litros, 2)} />
        <Dato label="Venta bruta" valor={formatUsd(t.ventaBruta, 2)} />
        <Dato
          label="Devoluciones"
          valor={formatUsd(t.devoluciones, 2)}
          detalle={`${formatPct(t.ventaBruta ? t.devoluciones / t.ventaBruta : null, 2)} de la bruta`}
        />
        <Dato label="Cajas · unidades" valor={formatNumero(t.cajas, 2)} detalle={`${formatNumero(t.unidades)} unidades`} />
        <Dato label="Documentos · clientes" valor={formatNumero(r.documentos)} detalle={`${formatNumero(r.clientes)} clientes`} />
      </div>

      <ul className="space-y-2">
        {r.solapes.length > 0 ? (
          <Chequeo nivel="aviso" titulo="Se solapa con cargas anteriores: el archivo nuevo manda en su período">
            {r.solapes.map((s) => (
              <p key={s.cargaId}>
                «{s.archivo}» ({formatFecha(s.periodoDesde)} – {formatFecha(s.periodoHasta)}): se reemplazan{" "}
                {formatNumero(s.filasReemplazadas)} filas ({formatUsd(s.ventaReemplazada)}). Revertir esta carga las
                devuelve.
              </p>
            ))}
          </Chequeo>
        ) : (
          <Chequeo nivel="ok" titulo="No se solapa con cargas anteriores" />
        )}

        {r.otrasHojasConFormato.length > 0 && (
          <Chequeo nivel="aviso" titulo="El libro tiene otras hojas con el mismo formato que no se leyeron">
            <p>
              Se leyó solo «{r.hoja}». No se leyeron: {r.otrasHojasConFormato.join(", ")}. Si también deben contar,
              súbelas en otro archivo.
            </p>
          </Chequeo>
        )}

        {r.productosSinCosto.total > 0 ? (
          <Chequeo
            nivel="aviso"
            titulo={`${r.productosSinCosto.total} producto(s) sin costo: ${formatUsd(r.productosSinCosto.ventaNeta)} de venta con margen desconocido`}
          >
            {r.productosSinCosto.productos.map((p) => (
              <p key={p.codigo} className="flex justify-between gap-3">
                <span>
                  {p.nombre} · {p.grupo} <span className="text-muted-foreground/70">({p.codigo})</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatUsd(p.ventaNeta)}</span>
              </p>
            ))}
          </Chequeo>
        ) : (
          <Chequeo nivel="ok" titulo="Todos los productos tienen costo por caja" />
        )}

        {r.desviosMargen.length > 0 && (
          <Chequeo nivel="aviso" titulo="Margen fuera de lo normal: revisar el costo por caja">
            {r.desviosMargen.map((d) => (
              <p key={d.codigo}>
                {d.nombre}: {formatPct(d.margenPct)} contra {formatPct(d.margenGrupoPct)} de su grupo ({d.grupo})
              </p>
            ))}
          </Chequeo>
        )}

        {r.productosDuplicados.length > 0 && (
          <Chequeo nivel="aviso" titulo="El mismo producto con más de un código">
            {r.productosDuplicados.map((d) => (
              <p key={d.nombre}>
                {d.nombre}: {d.codigos.join(" y ")}
              </p>
            ))}
          </Chequeo>
        )}

        {r.tasa.filasFueraDeRango > 0 ? (
          <Chequeo
            nivel="aviso"
            titulo={`${formatNumero(r.tasa.filasFueraDeRango)} fila(s) con la tasa Bs/USD fuera de rango`}
          >
            <p>
              Tasa mediana del archivo: {formatNumero(r.tasa.mediana, 2)}. Una tasa de 1 suele ser bolívares copiados en
              la columna de divisas.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left tabular-nums">
                <thead>
                  <tr className="text-muted-foreground/80">
                    <th className="pr-3 font-normal">Fila</th>
                    <th className="pr-3 font-normal">Fecha</th>
                    <th className="pr-3 font-normal">Documento</th>
                    <th className="pr-3 text-right font-normal">Bs</th>
                    <th className="pr-3 text-right font-normal">USD</th>
                    <th className="text-right font-normal">Tasa</th>
                  </tr>
                </thead>
                <tbody>
                  {r.tasa.muestra.map((m) => (
                    <tr key={m.fila}>
                      <td className="pr-3">{m.fila}</td>
                      <td className="pr-3">{formatFecha(m.fecha)}</td>
                      <td className="pr-3">{m.numDoc}</td>
                      <td className="pr-3 text-right">{formatNumero(m.montoBs, 2)}</td>
                      <td className="pr-3 text-right">{formatNumero(m.montoUsd, 2)}</td>
                      <td className="text-right">{formatNumero(m.tasa, 2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Chequeo>
        ) : (
          r.tasa.mediana != null && (
            <Chequeo nivel="ok" titulo={`Tasa Bs/USD dentro de rango (mediana ${formatNumero(r.tasa.mediana, 2)})`} />
          )
        )}

        {r.rutas.primeraCarga ? (
          <Chequeo
            nivel="info"
            titulo={`Primera carga de esta empresa: se dan de alta ${formatNumero(r.clientes)} clientes y ${formatNumero(r.productosNuevos.total)} productos`}
          >
            <p>Rutas en el archivo: {r.rutas.enArchivo.join(", ")}.</p>
          </Chequeo>
        ) : (
          <>
            {r.rutas.noReconocidas.length > 0 ? (
              <Chequeo nivel="aviso" titulo="Rutas que no aparecían en cargas anteriores">
                <p>{r.rutas.noReconocidas.join(", ")}</p>
              </Chequeo>
            ) : (
              <Chequeo nivel="ok" titulo="Todas las rutas son conocidas" />
            )}
            {r.clientesNuevos.total > 0 && (
              <Chequeo nivel="info" titulo={`${formatNumero(r.clientesNuevos.total)} cliente(s) nuevo(s)`}>
                <p>
                  {listaCorta(r.clientesNuevos.muestra.map((c) => `${c.nombre} (${c.codigo}, ruta ${c.ruta})`), 5)}
                  {r.clientesNuevos.total > r.clientesNuevos.muestra.length && "…"}
                </p>
              </Chequeo>
            )}
            {r.productosNuevos.total > 0 && (
              <Chequeo nivel="info" titulo={`${formatNumero(r.productosNuevos.total)} producto(s) nuevo(s)`}>
                <p>{listaCorta(r.productosNuevos.muestra.map((p) => `${p.nombre} (${p.codigo})`), 5)}</p>
              </Chequeo>
            )}
          </>
        )}

        {r.fueraDeLogistica.total > 0 && (
          <Chequeo
            nivel="info"
            titulo={`${formatNumero(r.fueraDeLogistica.total)} de ${formatNumero(r.clientes)} clientes no están en el maestro de clientes de logística (${formatUsd(r.fueraDeLogistica.ventaNeta)})`}
          >
            <p>No se les puede armar un despacho hasta darlos de alta en Clientes.</p>
          </Chequeo>
        )}
      </ul>

      <p className="text-xs text-muted-foreground">
        Hoja leída: «{r.hoja}». Costo por caja:{" "}
        {r.fuenteCosto ?? "el archivo no trae costos, se usan los ya cargados de cargas anteriores"}.
      </p>
    </div>
  );
}
