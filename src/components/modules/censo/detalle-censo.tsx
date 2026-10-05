import { ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { API_URL } from "@/lib/api-client";
import type { DetalleCenso } from "@/lib/censo";
import type { Valor } from "@/lib/formulario/expresiones";
import { esGrupo, type DefinicionFormulario, type Nodo, type Pregunta } from "@/lib/formulario/motor";
import { HtmlLimpio, textoPlano } from "./html-limpio";

type Foto = DetalleCenso["fotos"][number];

function ValorRespuesta({ pregunta: p, valor, definicion, fotos }: { pregunta: Pregunta; valor: Valor; definicion: DefinicionFormulario; fotos: Foto[] }) {
  if (p.type === "image") {
    const foto = fotos.find((f) => f.pregunta === p.name);
    if (!foto) return <span className="text-muted-foreground">Sin foto</span>;
    const url = `${API_URL}/censo/fotos/${foto.id}`;
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element -- la sirve la API con la sesión, no pasa por next/image */}
        <img src={url} alt={textoPlano(p.label) || p.name} className="h-40 w-auto rounded-md border object-cover" />
      </a>
    );
  }
  if (p.type === "geopoint" && valor && typeof valor === "object" && !Array.isArray(valor)) {
    return (
      <a
        href={`https://www.google.com/maps?q=${valor.lat},${valor.lng}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 tabular-nums underline-offset-4 hover:underline"
      >
        {valor.lat.toFixed(6)}, {valor.lng.toFixed(6)}
        {valor.precision != null && <span className="text-muted-foreground"> · ±{valor.precision} m</span>}
        <ExternalLinkIcon className="size-3.5" />
      </a>
    );
  }
  if (p.list) {
    const opciones = definicion.choices[p.list] ?? [];
    const nombres = Array.isArray(valor) ? valor : [String(valor)];
    return <span>{nombres.map((n) => textoPlano(opciones.find((o) => o.name === n)?.label) || n).join(", ")}</span>;
  }
  return <span className="whitespace-pre-wrap">{String(valor)}</span>;
}

/** Las respuestas en el orden y con los grupos del formulario. Solo se ven
 * las que se respondieron: las preguntas que no aplicaban no tienen valor. */
export function DetalleDeCenso({ censo, definicion }: { censo: DetalleCenso; definicion: DefinicionFormulario }) {
  const respondidas = new Set(Object.keys(censo.respuestas));
  const conocidas = new Set<string>();

  function filas(nodos: Nodo[]): React.ReactNode[] {
    return nodos.flatMap((n) => {
      if (esGrupo(n)) return [];
      conocidas.add(n.name);
      if (!respondidas.has(n.name) && !(n.type === "image" && censo.fotos.some((f) => f.pregunta === n.name))) return [];
      return [
        <div key={n.name} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
          <dt className="text-sm text-muted-foreground">
            <HtmlLimpio html={n.label ?? n.name} />
          </dt>
          <dd className="text-sm">
            <ValorRespuesta pregunta={n} valor={censo.respuestas[n.name]} definicion={definicion} fotos={censo.fotos} />
          </dd>
        </div>,
      ];
    });
  }

  function bloque(titulo: string | undefined, nodos: Nodo[], clave: string): React.ReactNode[] {
    const propias = filas(nodos);
    const internos = nodos.filter(esGrupo).flatMap((g) => bloque(g.label, g.children, g.name ?? clave));
    if (!propias.length) return internos;
    return [
      <Card key={clave}>
        {titulo && (
          <CardHeader>
            <CardTitle>
              <HtmlLimpio html={titulo} />
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className={titulo ? undefined : "pt-4"}>
          <dl className="divide-y">{propias}</dl>
        </CardContent>
      </Card>,
      ...internos,
    ];
  }

  const bloques = bloque(undefined, definicion.children, "general");
  const otras = Object.keys(censo.respuestas).filter((n) => !conocidas.has(n));

  return (
    <div className="space-y-4">
      {!censo.versionVigente && (
        <p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
          Este censo se llenó con otra versión del formulario ({censo.version}). Las preguntas que cambiaron desde
          entonces aparecen al final con su nombre interno.
        </p>
      )}
      {bloques}
      {otras.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Otras respuestas</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              {otras.map((n) => (
                <div key={n} className="grid gap-1 py-2.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:gap-4">
                  <dt className="font-mono text-xs text-muted-foreground">{n}</dt>
                  <dd className="text-sm">{JSON.stringify(censo.respuestas[n])}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
