import { expect, test } from "bun:test"
import { miniTheme } from "@lemol/ui/mini"
import { theme, themeOverrides } from "../../src/web/app/ui/theme.ts"

test("theme overrides are pinned to the justified list", () => {
  // Every deviation from miniTheme must be justified in task 28.
  // Today, no overrides are justified, so the set is empty.
  expect(Object.keys(themeOverrides)).toEqual([])
  expect(theme).toBe(miniTheme)
})
