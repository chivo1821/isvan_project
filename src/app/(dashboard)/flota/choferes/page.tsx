import { PageHeader } from "@/components/layout/page-header";
import { ChoferesTable, type RutaDelVehiculo } from "@/components/modules/flota/choferes-table";
import { MotorizadosPanel } from "@/components/modules/flota/motorizados-panel";
import { apiGet } from "@/lib/api-client";
import { getRutasActivas, getUsuariosRaw, getVehiculosRaw } from "@/lib/mock-data";
import type { CodigoRegistro, Motorizado } from "@/lib/motorizados";
import type { AjustePlanificacion } from "@/lib/planificacion";
import { getUsuarioActual } from "@/lib/session";

export default async function ChoferesPage() {
  const [usuarios, vehiculos, rutasActivas, usuarioActual] = await Promise.all([
    getUsuariosRaw(),
    getVehiculosRaw(),
    getRutasActivas(),
    getUsuarioActual(),
  ]);
  const esAdmin = usuarioActual?.rol === "ADMIN";
  const puedeEditar = esAdmin || usuarioActual?.rol === "DESPACHOS";

  // Los motorizados autogestionados andan en su propia moto: no se
  // reasignan, así que ni ellos ni sus motos entran a la tabla de choferes.
  // Se administran aparte, en el panel de abajo (solo ADMIN).
  const motosDeMotorizados = new Set(
    usuarios.filter((u) => u.autogestionado && u.vehiculoAsignadoId).map((u) => u.vehiculoAsignadoId!)
  );
  const choferes = usuarios
    .filter((u) => u.rol === "REPARTIDOR" && u.activo && !u.autogestionado)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
  const vehiculosAsignables = vehiculos.filter((v) => !motosDeMotorizados.has(v.id));
  // Un vehículo lleva una sola ruta activa a la vez (ver backend crear_ruta).
  const rutaPorVehiculo: Record<string, RutaDelVehiculo> = Object.fromEntries(
    rutasActivas.map((r) => [r.vehiculoId, { id: r.id, numero: r.numero, estado: r.estado }])
  );

  const [motorizados, codigo, ajustes] = esAdmin
    ? await Promise.all([
        apiGet<Motorizado[]>("/motorizados"),
        apiGet<CodigoRegistro>("/motorizados/codigo-registro"),
        apiGet<AjustePlanificacion[]>("/rutas/configuracion").catch(() => []),
      ])
    : [null, null, []];
  const capacidadKg = ajustes.find((a) => a.clave === "motoCapacidadKg")?.valor ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Choferes"
        subtitle="Quién maneja cada vehículo. El cambio es inmediato: desde ese momento el chofer ve la ruta activa de su vehículo nuevo"
        helpText="Un chofer es un usuario con rol Repartidor; para agregar uno, créalo en Usuarios. Los motorizados se registran solos y se administran abajo."
      />
      <ChoferesTable
        choferes={choferes}
        vehiculos={vehiculosAsignables}
        rutaPorVehiculo={rutaPorVehiculo}
        puedeEditar={puedeEditar}
      />
      {motorizados && codigo && (
        <MotorizadosPanel motorizados={motorizados} codigo={codigo} capacidadKg={capacidadKg} />
      )}
    </div>
  );
}
