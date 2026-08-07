import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type WizardStep = {
  id: string;
  label: string;
};

export function StepWizard({
  steps,
  currentStep,
}: {
  steps: WizardStep[];
  /** 1-indexed: el paso actualmente activo */
  currentStep: number;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-2">
      {steps.map((step, index) => {
        const stepNumber = index + 1;
        const isCompleted = stepNumber < currentStep;
        const isActive = stepNumber === currentStep;

        return (
          <li key={step.id} className="flex items-center gap-2">
            <div
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
                isActive && "bg-primary text-primary-foreground",
                isCompleted && "bg-success/10 text-success",
                !isActive && !isCompleted && "bg-muted text-muted-foreground"
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isActive && "bg-primary-foreground text-primary",
                  isCompleted && "bg-success text-success-foreground",
                  !isActive && !isCompleted && "bg-border text-muted-foreground"
                )}
              >
                {isCompleted ? <CheckIcon className="size-3" /> : stepNumber}
              </span>
              {step.label}
            </div>
            {stepNumber < steps.length && (
              <span className="h-px w-6 shrink-0 bg-border" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}
