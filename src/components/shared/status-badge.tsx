import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Tone } from "@/lib/constants";

const TONE_CLASSES: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary/10 text-primary",
};

export function StatusBadge({
  label,
  tone,
  className,
}: {
  label: string;
  tone: Tone;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", TONE_CLASSES[tone], className)}>
      {label}
    </Badge>
  );
}
