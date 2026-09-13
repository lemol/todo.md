export const respondDefect = (defect: unknown): Response =>
  new Response(defect instanceof Error ? defect.message : String(defect), { status: 500 })
