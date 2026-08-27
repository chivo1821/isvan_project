import { IceCreamConeIcon } from "lucide-react";
import { LoginForm } from "@/components/modules/auth/login-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <IceCreamConeIcon className="size-5" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-foreground">Gestión Logística</h1>
            <p className="text-sm text-muted-foreground">Helados &amp; Pizzas — ISVAN / TRALOG</p>
          </div>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
