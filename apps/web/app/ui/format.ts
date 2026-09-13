export const showId = (id: string): string => (/^\d+$/.test(id) ? id.padStart(2, "0") : id)

export const formatDate = (value: Date | undefined): string =>
  value === undefined ? "Unknown" : value.toISOString().slice(0, 10)

export const diagnosticCounts = (diagnostics: ReadonlyArray<{ severity: string }>) => ({
  error: diagnostics.filter((item) => item.severity === "error").length,
  warning: diagnostics.filter((item) => item.severity === "warning").length,
  info: diagnostics.filter((item) => item.severity === "info").length,
})
