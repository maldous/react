export const packageName = "@platform/feature-workflow";

export interface WorkflowStep {
  id: string;
  label: string;
  description?: string;
  optional?: boolean;
}

export interface WorkflowState {
  currentIndex: number;
  currentStep: WorkflowStep;
  isFirst: boolean;
  isLast: boolean;
  steps: WorkflowStep[];
}

export interface WorkflowMachine {
  steps: WorkflowStep[];
  currentIndex(): number;
  currentStep(): WorkflowStep;
  next(): void;
  prev(): void;
  goTo(index: number): void;
  isFirst(): boolean;
  isLast(): boolean;
  reset(): void;
  snapshot(): WorkflowState;
}

export function createWorkflowMachine(steps: WorkflowStep[]): WorkflowMachine {
  if (steps.length === 0) throw new Error("Workflow must have at least one step");
  let index = 0;

  return {
    steps,
    currentIndex: () => index,
    currentStep: () => steps[index]!,
    next() {
      if (index < steps.length - 1) index++;
    },
    prev() {
      if (index > 0) index--;
    },
    goTo(i) {
      if (i >= 0 && i < steps.length) index = i;
    },
    isFirst: () => index === 0,
    isLast: () => index === steps.length - 1,
    reset() {
      index = 0;
    },
    snapshot() {
      return {
        currentIndex: index,
        currentStep: steps[index]!,
        isFirst: index === 0,
        isLast: index === steps.length - 1,
        steps,
      };
    },
  };
}

export function createWorkflowState(steps: WorkflowStep[], index: number): WorkflowState {
  return {
    currentIndex: index,
    currentStep: steps[index]!,
    isFirst: index === 0,
    isLast: index === steps.length - 1,
    steps,
  };
}
