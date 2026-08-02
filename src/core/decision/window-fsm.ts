/**
 * ARC — Window FSM (M2).
 *
 * CONFIGURED → WAITING → ACTIVE → EVALUATING → (EXECUTING) → COMPLETED.
 * Every window instance completes exactly once; COMPLETED is terminal.
 */
import { type WindowEvent, type WindowState } from "./types";
import { defineStateMachine, type StateMachineDefinition } from "../infrastructure/fsm";

export const WINDOW_FSM: StateMachineDefinition<WindowState, WindowEvent> = defineStateMachine({
  id: "window-instance",
  initial: "CONFIGURED",
  states: ["CONFIGURED", "WAITING", "ACTIVE", "EVALUATING", "EXECUTING", "COMPLETED"],
  terminal: ["COMPLETED"],
  transitions: [
    { from: "CONFIGURED", event: "OPEN", to: "WAITING", reasonCode: "DEC_WINDOW_OPENED" },
    { from: "WAITING", event: "ACTIVATE", to: "ACTIVE", reasonCode: "DEC_WINDOW_ACTIVATED" },
    { from: "ACTIVE", event: "EVALUATE", to: "EVALUATING", reasonCode: "DEC_WINDOW_EVALUATED" },
    {
      from: "EVALUATING",
      event: "EVALUATION_INCONCLUSIVE",
      to: "ACTIVE",
      reasonCode: "DEC_NO_SIGNAL",
    },
    {
      from: "EVALUATING",
      event: "INTENT_CREATED",
      to: "EXECUTING",
      reasonCode: "DEC_INTENT_CREATED",
    },
    { from: "CONFIGURED", event: "COMPLETE", to: "COMPLETED", reasonCode: "DEC_WINDOW_COMPLETED" },
    { from: "WAITING", event: "COMPLETE", to: "COMPLETED", reasonCode: "DEC_WINDOW_COMPLETED" },
    { from: "ACTIVE", event: "COMPLETE", to: "COMPLETED", reasonCode: "DEC_WINDOW_COMPLETED" },
    { from: "EVALUATING", event: "COMPLETE", to: "COMPLETED", reasonCode: "DEC_WINDOW_COMPLETED" },
    { from: "EXECUTING", event: "COMPLETE", to: "COMPLETED", reasonCode: "DEC_WINDOW_COMPLETED" },
  ],
});
