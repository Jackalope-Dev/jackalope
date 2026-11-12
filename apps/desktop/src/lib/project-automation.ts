import type { DecideSettings, PlanSettings } from './plan-mode.ts';

export type AutomationPreset = 'hands-on' | 'balanced' | 'autonomous';

/** The settings a "How hands-on?" preset sets, read from where each one is stored. */
export interface AutomationValues {
  autoApprove: boolean;
  automaticSubtasks: boolean;
  autoVerify: boolean;
  learnAutomatically: boolean;
  agentReflection: boolean;
  decideQuestions: boolean;
  decideRounds: boolean;
  decideDeviations: boolean;
  askBeforeRounds: boolean;
}

/**
 * Concrete values per preset. Balanced matches the defaults, so a project nobody has tuned
 * reads as Balanced. Review screenshots stay out: they depend on a preview command.
 */
export const AUTOMATION_PRESETS: Record<AutomationPreset, AutomationValues> = {
  'hands-on': {
    autoApprove: false,
    automaticSubtasks: false,
    autoVerify: false,
    learnAutomatically: false,
    agentReflection: false,
    decideQuestions: false,
    decideRounds: false,
    decideDeviations: false,
    askBeforeRounds: true,
  },
  balanced: {
    autoApprove: true,
    automaticSubtasks: true,
    autoVerify: false,
    learnAutomatically: true,
    agentReflection: false,
    decideQuestions: false,
    decideRounds: false,
    decideDeviations: false,
    askBeforeRounds: false,
  },
  autonomous: {
    autoApprove: true,
    automaticSubtasks: true,
    autoVerify: true,
    learnAutomatically: true,
    agentReflection: true,
    decideQuestions: true,
    decideRounds: true,
    decideDeviations: true,
    askBeforeRounds: false,
  },
};

const AUTOMATION_LABELS: Record<keyof AutomationValues, string> = {
  autoApprove: 'Auto-approve agent requests',
  automaticSubtasks: 'Split work into subtasks',
  autoVerify: 'Check results automatically',
  learnAutomatically: 'Learn automatically',
  agentReflection: 'Reflect with an agent',
  decideQuestions: 'Let agents decide routine questions',
  decideRounds: 'Let agents approve swarm rounds',
  decideDeviations: 'Let agents handle plan deviations within scope',
  askBeforeRounds: 'Ask before each swarm round',
};

interface ProjectAutomationPreferences {
  autoApprove?: boolean;
  automaticSubtasks?: boolean;
  autoVerify?: boolean;
  learnAutomatically?: boolean;
  agentReflection?: boolean;
}

/** Current values with each stored setting's own default, as the settings rows read them. */
export function automationValues(
  preferences: ProjectAutomationPreferences | undefined,
  plan: Pick<PlanSettings, 'askBeforeRounds' | 'decide'> | undefined,
): AutomationValues {
  const decide: Partial<DecideSettings> = plan?.decide ?? {};
  return {
    autoApprove: preferences?.autoApprove !== false,
    automaticSubtasks: preferences?.automaticSubtasks !== false,
    autoVerify: preferences?.autoVerify === true,
    learnAutomatically: preferences?.learnAutomatically !== false,
    agentReflection: preferences?.agentReflection === true,
    decideQuestions: decide.questions === true,
    decideRounds: decide.rounds === true,
    decideDeviations: decide.deviations === true,
    askBeforeRounds: plan?.askBeforeRounds === true,
  };
}

/** The preset the values match exactly, or `custom`. Derived only; nothing stores it. */
export function matchingPreset(values: AutomationValues): AutomationPreset | 'custom' {
  const match = (Object.keys(AUTOMATION_PRESETS) as AutomationPreset[]).find((preset) =>
    (Object.keys(values) as (keyof AutomationValues)[]).every(
      (key) => AUTOMATION_PRESETS[preset][key] === values[key],
    ),
  );
  return match ?? 'custom';
}

/** The settings a preset would change, with their before and after values. */
export function automationChanges(from: AutomationValues, to: AutomationValues) {
  return (Object.keys(to) as (keyof AutomationValues)[])
    .filter((key) => from[key] !== to[key])
    .map((key) => ({ key, label: AUTOMATION_LABELS[key], from: from[key], to: to[key] }));
}

/** Splits values into the project preference fields and the plan settings it changes. */
export function automationWrites(values: AutomationValues, plan: PlanSettings) {
  return {
    preferences: {
      autoApprove: values.autoApprove,
      automaticSubtasks: values.automaticSubtasks,
      autoVerify: values.autoVerify,
      learnAutomatically: values.learnAutomatically,
      agentReflection: values.agentReflection,
    },
    plan: {
      ...plan,
      askBeforeRounds: values.askBeforeRounds,
      decide: {
        questions: values.decideQuestions,
        rounds: values.decideRounds,
        deviations: values.decideDeviations,
        maxAgentDecisions: plan.decide?.maxAgentDecisions ?? 50,
        decider: plan.decide?.decider ?? 'auto',
      },
    } satisfies PlanSettings,
  };
}
