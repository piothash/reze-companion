/**
 * ARC — Order FSM (M3).
 *
 * CREATED → SUBMITTED → WORKING → PARTIALLY_FILLED → FILLED | CANCELLED |
 * REJECTED | EXPIRED. Deterministic, recovery safe and replay safe: the state
 * is a pure function of the ordered event list, so rebuilding an order from a
 * persisted transition log always yields the same state.
 */
import { defineStateMachine, type StateMachineDefinition } from "../infrastructure/fsm";
import { type OrderEvent, type OrderState } from "./types";

export const ORDER_FSM: StateMachineDefinition<OrderState, OrderEvent> = defineStateMachine({
  id: "order",
  initial: "CREATED",
  states: [
    "CREATED",
    "SUBMITTED",
    "WORKING",
    "PARTIALLY_FILLED",
    "FILLED",
    "CANCELLED",
    "REJECTED",
    "EXPIRED",
  ],
  terminal: ["FILLED", "CANCELLED", "REJECTED", "EXPIRED"],
  transitions: [
    { from: "CREATED", event: "SUBMIT", to: "SUBMITTED", reasonCode: "EXE_ORDER_SUBMITTED" },
    { from: "CREATED", event: "REJECT", to: "REJECTED", reasonCode: "EXE_ORDER_REJECTED" },
    { from: "CREATED", event: "CANCEL", to: "CANCELLED", reasonCode: "EXE_ORDER_CANCELLED" },

    { from: "SUBMITTED", event: "ACKNOWLEDGE", to: "WORKING", reasonCode: "EXE_ORDER_WORKING" },
    { from: "SUBMITTED", event: "REJECT", to: "REJECTED", reasonCode: "EXE_ORDER_REJECTED" },
    {
      from: "SUBMITTED",
      event: "PARTIAL_FILL",
      to: "PARTIALLY_FILLED",
      reasonCode: "EXE_ORDER_PARTIALLY_FILLED",
    },
    { from: "SUBMITTED", event: "FILL", to: "FILLED", reasonCode: "EXE_ORDER_FILLED" },
    { from: "SUBMITTED", event: "CANCEL", to: "CANCELLED", reasonCode: "EXE_ORDER_CANCELLED" },
    { from: "SUBMITTED", event: "EXPIRE", to: "EXPIRED", reasonCode: "EXE_ORDER_EXPIRED" },

    {
      from: "WORKING",
      event: "PARTIAL_FILL",
      to: "PARTIALLY_FILLED",
      reasonCode: "EXE_ORDER_PARTIALLY_FILLED",
    },
    { from: "WORKING", event: "FILL", to: "FILLED", reasonCode: "EXE_ORDER_FILLED" },
    { from: "WORKING", event: "CANCEL", to: "CANCELLED", reasonCode: "EXE_ORDER_CANCELLED" },
    { from: "WORKING", event: "EXPIRE", to: "EXPIRED", reasonCode: "EXE_ORDER_EXPIRED" },
    { from: "WORKING", event: "REJECT", to: "REJECTED", reasonCode: "EXE_ORDER_REJECTED" },

    {
      from: "PARTIALLY_FILLED",
      event: "PARTIAL_FILL",
      to: "PARTIALLY_FILLED",
      reasonCode: "EXE_ORDER_PARTIALLY_FILLED",
    },
    { from: "PARTIALLY_FILLED", event: "FILL", to: "FILLED", reasonCode: "EXE_ORDER_FILLED" },
    {
      from: "PARTIALLY_FILLED",
      event: "CANCEL",
      to: "CANCELLED",
      reasonCode: "EXE_ORDER_CANCELLED",
    },
    { from: "PARTIALLY_FILLED", event: "EXPIRE", to: "EXPIRED", reasonCode: "EXE_ORDER_EXPIRED" },
  ],
});
