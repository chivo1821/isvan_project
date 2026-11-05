import type { ReactNode } from "react";
import { HelpCircleIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function PageHeader({
  title,
  subtitle,
  helpText,
  actions,
}: {
  title: string;
  subtitle?: string;
  helpText?: string;
  actions?: ReactNode;
}) {
  return (
    // Con flex-wrap los botones bajan a otra línea cuando no caben al lado
    // del título (teléfono, o computadora con zoom), en vez de salirse.
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="flex min-w-0 flex-[1_1_16rem] items-start gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            {helpText && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground max-sm:-m-3 max-sm:p-3"
                    aria-label="Ayuda"
                  >
                    <HelpCircleIcon className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{helpText}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
