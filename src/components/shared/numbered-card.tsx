import type { ReactNode } from "react";
import { HelpCircleIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export function NumberedCard({
  number,
  title,
  helpText,
  children,
  className,
}: {
  number: number;
  title: string;
  helpText?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn(className)}>
      <CardHeader className="flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
            {number}
          </span>
          <CardTitle>{title}</CardTitle>
        </div>
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
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
