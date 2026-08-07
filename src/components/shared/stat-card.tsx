import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  icon: Icon,
  label,
  value,
  trend,
  tone = "primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  trend?: string;
  tone?: "primary" | "success" | "warning" | "destructive" | "info";
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold text-foreground">{value}</p>
          {trend && <p className="mt-1 text-xs text-muted-foreground">{trend}</p>}
        </div>
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            tone === "primary" && "bg-primary/10 text-primary",
            tone === "success" && "bg-success/10 text-success",
            tone === "warning" && "bg-warning/10 text-warning",
            tone === "destructive" && "bg-destructive/10 text-destructive",
            tone === "info" && "bg-info/10 text-info"
          )}
        >
          <Icon className="size-5" />
        </span>
      </CardContent>
    </Card>
  );
}
