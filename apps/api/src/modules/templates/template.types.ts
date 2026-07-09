import type { CreateProcessInput } from "../processes/process.types";
import type { CreateRoutineInput } from "../routines/routine.types";
import type { CreateTrainingInput } from "../trainings/training.types";

export type TemplateKind = "process" | "routine" | "training";
export type TemplateSegment = "marketing_agency" | "general_ops" | "local_services";

export type TemplateSummary = {
  id: string;
  title: string;
  description: string;
  segment: TemplateSegment;
  area: string;
  kind: TemplateKind;
  category: string;
  tag: string;
  icon: string;
  adaptPrompt: string;
};

type OperationalTemplateBase = TemplateSummary & {
  suggestedUse: string;
};

export type ProcessTemplate = OperationalTemplateBase & {
  kind: "process";
  content: CreateProcessInput;
};

export type RoutineTemplate = OperationalTemplateBase & {
  kind: "routine";
  content: CreateRoutineInput;
};

export type TrainingTemplate = OperationalTemplateBase & {
  kind: "training";
  content: CreateTrainingInput;
};

export type OperationalTemplate = ProcessTemplate | RoutineTemplate | TrainingTemplate;

