import type { Theme } from "@lemol/ui/design"
import { miniTheme } from "@lemol/ui/mini"
import type { ComponentTokenName } from "@lemol/ui/remix"

/**
 * Local theme overrides against miniTheme.
 *
 * Every deviation from miniTheme must be justified in task 28 (and the M3 plan:
 * docs/superpowers/plans/2026-09-20-m3-todo-md-adoption.md, D4) and pinned in
 * test/web/theme.test.ts. Today, miniTheme is adopted verbatim without deviations.
 */
export const themeOverrides: Partial<Record<ComponentTokenName, string>> = {}

export const theme: Theme<ComponentTokenName> = miniTheme
