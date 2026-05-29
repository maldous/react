import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkflowMachine, createWorkflowState } from "../src/index.ts";

const steps = [
  { id: "step1", label: "Step 1" },
  { id: "step2", label: "Step 2" },
  { id: "step3", label: "Step 3" },
];

describe("createWorkflowMachine", () => {
  it("starts at step 0", () => {
    const machine = createWorkflowMachine(steps);
    assert.strictEqual(machine.currentIndex(), 0);
    assert.strictEqual(machine.currentStep().id, "step1");
  });
  it("next advances to next step", () => {
    const machine = createWorkflowMachine(steps);
    machine.next();
    assert.strictEqual(machine.currentIndex(), 1);
    assert.strictEqual(machine.currentStep().id, "step2");
  });
  it("prev goes back", () => {
    const machine = createWorkflowMachine(steps);
    machine.next();
    machine.prev();
    assert.strictEqual(machine.currentIndex(), 0);
  });
  it("prev does not go before first step", () => {
    const machine = createWorkflowMachine(steps);
    machine.prev();
    assert.strictEqual(machine.currentIndex(), 0);
  });
  it("isFirst and isLast", () => {
    const machine = createWorkflowMachine(steps);
    assert.ok(machine.isFirst());
    assert.ok(!machine.isLast());
    machine.next();
    machine.next();
    assert.ok(!machine.isFirst());
    assert.ok(machine.isLast());
  });
  it("goTo jumps to index", () => {
    const machine = createWorkflowMachine(steps);
    machine.goTo(2);
    assert.strictEqual(machine.currentStep().id, "step3");
  });
  it("next does not advance past last step", () => {
    const machine = createWorkflowMachine(steps);
    machine.goTo(2);
    machine.next();
    assert.strictEqual(machine.currentIndex(), 2);
  });
  it("reset returns to step 0", () => {
    const machine = createWorkflowMachine(steps);
    machine.goTo(2);
    machine.reset();
    assert.strictEqual(machine.currentIndex(), 0);
  });
  it("snapshot returns correct state", () => {
    const machine = createWorkflowMachine(steps);
    machine.next();
    const snap = machine.snapshot();
    assert.strictEqual(snap.currentIndex, 1);
    assert.strictEqual(snap.currentStep.id, "step2");
    assert.ok(!snap.isFirst);
    assert.ok(!snap.isLast);
  });
  it("throws when steps array is empty", () => {
    assert.throws(() => createWorkflowMachine([]), { message: /at least one step/i });
  });
});

describe("createWorkflowState", () => {
  it("creates correct state at index 1", () => {
    const state = createWorkflowState(steps, 1);
    assert.strictEqual(state.currentIndex, 1);
    assert.strictEqual(state.currentStep.id, "step2");
    assert.ok(!state.isFirst);
    assert.ok(!state.isLast);
  });
});
