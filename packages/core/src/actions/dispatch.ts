import type { DispatchInput } from "./workflows"

/** Form state of dispatch inputs: checkboxes hold booleans, every other input holds text. */
export type DispatchValues = Record<string, string | boolean>

export function initialDispatchValues(inputs: DispatchInput[]): DispatchValues {
  return Object.fromEntries(
    inputs.map((input) => {
      if (input.type === "boolean")
        return [input.name, input.default === true || input.default === "true"]
      if (input.type === "choice")
        return [input.name, String(input.default ?? input.options[0] ?? "")]
      return [input.name, input.default == null ? "" : String(input.default)]
    }),
  )
}

export type DispatchPayload =
  | { ok: true; inputs: Record<string, string | boolean | number> }
  | { ok: false; errors: Record<string, string> }

/** Validates form values and converts them to the `inputs` of a dispatch request. */
export function dispatchPayload(inputs: DispatchInput[], values: DispatchValues): DispatchPayload {
  const payload: Record<string, string | boolean | number> = {}
  const errors: Record<string, string> = {}
  for (const input of inputs) {
    const value = values[input.name]
    if (typeof value === "boolean") {
      payload[input.name] = value
      continue
    }
    const text = (value ?? "").trim()
    if (!text) {
      // Omitted inputs take the workflow's default.
      if (input.required) errors[input.name] = "Required"
      continue
    }
    if (input.type === "number") {
      if (Number.isNaN(Number(text))) errors[input.name] = "Must be a number"
      else payload[input.name] = Number(text)
    } else if (input.type === "choice" && input.options.length && !input.options.includes(text)) {
      errors[input.name] = "Pick one of the options"
    } else {
      payload[input.name] = text
    }
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, inputs: payload }
}
