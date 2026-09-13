import { routes } from "../routes.ts"
import { escapeHtml } from "./document.tsx"

export const RenameGroupPage = (
  from: string,
  to: string = from,
  issues: ReadonlyArray<string> = [],
): string =>
  `<h1>Rename group</h1>${issues.length === 0 ? "" : `<ul class="issues">${issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>`}<p>Done tasks keep the name they were completed under.</p><form class="edit-form" method="post" action="${routes.groups.rename.href()}"><input type="hidden" name="from" value="${escapeHtml(from)}"><label>Name <input name="to" value="${escapeHtml(to)}" required></label><div class="actions confirm"><button class="primary" type="submit">Rename</button><a class="secondary" href="${routes.board.href()}">Cancel</a></div></form>`
