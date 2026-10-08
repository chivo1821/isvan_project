import { Suspense } from "react";
import { ConfirmarForm } from "@/components/modules/portal/confirmar-form";

// ConfirmarForm lee la URL (useSearchParams): Next exige Suspense para el prerender.
export default function Page() {
  return (
    <Suspense>
      <ConfirmarForm />
    </Suspense>
  );
}
