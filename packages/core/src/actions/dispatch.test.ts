import { expect, test } from "vitest"
import { dispatchPayload, initialDispatchValues } from "./dispatch"
import type { DispatchInput } from "./workflows"

const input = (spec: Partial<DispatchInput> & Pick<DispatchInput, "name">): DispatchInput => ({
  type: "string",
  description: null,
  required: false,
  default: null,
  options: [],
  ...spec,
})

const inputs = [
  input({ name: "env", type: "choice", required: true, options: ["staging", "production"] }),
  input({ name: "dry-run", type: "boolean", default: true }),
  input({ name: "count", type: "number", default: 3 }),
  input({ name: "note" }),
]

test("starts from the workflow defaults", () => {
  expect(initialDispatchValues(inputs)).toEqual({
    env: "staging",
    "dry-run": true,
    count: "3",
    note: "",
  })
})

test("converts values and omits empty optional inputs", () => {
  expect(dispatchPayload(inputs, initialDispatchValues(inputs))).toEqual({
    ok: true,
    inputs: { env: "staging", "dry-run": true, count: 3 },
  })
})

test("reports missing required inputs and invalid values", () => {
  expect(dispatchPayload(inputs, { env: "", "dry-run": false, count: "many", note: "" })).toEqual({
    ok: false,
    errors: { env: "Required", count: "Must be a number" },
  })
  expect(dispatchPayload(inputs, { env: "prod", "dry-run": false, count: "", note: "" })).toEqual({
    ok: false,
    errors: { env: "Pick one of the options" },
  })
})
