import { Suspense } from "react";
import { IngresarForm } from "@/components/modules/portal/ingresar-form";

// IngresarForm lee la URL (useSearchParams): Next exige Suspense para el prerender.
export default function Page() {
  return (
    <Suspense>
      <IngresarForm />
    </Suspense>
  );
}
