export interface AppAssets {
  readonly getScriptEntry: (path: string) => Promise<{ readonly href: string }>
  readonly fetch: (request: Request) => Promise<Response | undefined>
  readonly close: () => Promise<void>
}

export const createAssets = (): AppAssets => ({
  getScriptEntry: async (path) => ({ href: `/assets/${path}` }),
  fetch: async () => undefined,
  close: async () => undefined,
})
