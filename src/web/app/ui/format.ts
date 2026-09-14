import { DateTime } from "effect"

export const showId = (id: string): string => (/^\d+$/.test(id) ? id.padStart(2, "0") : id)

export const formatDate = (value: DateTime.Utc | undefined): string =>
  value === undefined ? "Unknown" : DateTime.formatIso(value).slice(0, 10)

export const formatMinute = (value: DateTime.Utc): string =>
  DateTime.formatIso(value).slice(0, 16).replace("T", " ")

export const diagnosticCounts = (diagnostics: ReadonlyArray<{ severity: string }>) => ({
  error: diagnostics.filter((item) => item.severity === "error").length,
  warning: diagnostics.filter((item) => item.severity === "warning").length,
  info: diagnostics.filter((item) => item.severity === "info").length,
})
