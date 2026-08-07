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
    <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            {helpText && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
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
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
