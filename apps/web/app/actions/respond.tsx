/** @jsxImportSource remix/ui */
import { ErrorPage } from "../ui/document.tsx"
import { renderPage, scriptEntryOf, type WebContext } from "./page.ts"

type TaggedFailure = { readonly _tag: string } & Record<string, unknown>

const isTaggedFailure = (value: unknown): value is TaggedFailure =>
  typeof value === "object" && value !== null && "_tag" in value && typeof value._tag === "string"

export const errorDescription = (error: unknown): string => {
  if (!isTaggedFailure(error)) return error instanceof Error ? error.message : String(error)
  switch (error._tag) {
    case "TaskNotFound":
      return `Task ${String(error.id)} was not found.`
    case "GroupNotFound":
      return `Group ${String(error.name)} was not found.`
    case "InvalidTransition":
      return `Task ${String(error.id)} cannot be ${String(error.operation)}${String(error.operation).endsWith("e") ? "d" : "ed"} while it is ${String(error.status)}.`
    case "ValidationError":
      return Array.isArray(error.issues) ? error.issues.join(" ") : "The submitted task is invalid."
    case "Unsupported":
      return `This list does not support ${String(error.operation)}.`
    case "HasDependents":
      return `Task ${String(error.id)} still has open tasks depending on it: ${
        Array.isArray(error.dependents) ? error.dependents.join(", ") : ""
      }.`
    case "StoreError":
      return String(error.message)
    default:
      return `Unexpected ${error._tag} failure.`
  }
}

export const statusFor = (error: unknown): number => {
  if (!isTaggedFailure(error)) return 500
  switch (error._tag) {
    case "TaskNotFound":
      return 404
    case "GroupNotFound":
    case "Unsupported":
    case "InvalidTransition":
      return 400
    case "ValidationError":
      return 400
    case "HasDependents":
      return 409
    default:
      return 500
  }
}

export const respond = (context: WebContext, error: unknown): Response => {
  const status = statusFor(error)
  return renderPage(
    context,
    <ErrorPage
      status={status}
      message={errorDescription(error)}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status },
  )
}

export const respondDefect = (context: WebContext, defect: unknown): Response =>
  renderPage(
    context,
    <ErrorPage
      status={500}
      message={errorDescription(defect)}
      scriptEntry={scriptEntryOf(context)}
    />,
    { status: 500 },
  )
