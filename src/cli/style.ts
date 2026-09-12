/** Terminal styling: ANSI colors when enabled, plain text otherwise. */
export interface Style {
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
  readonly red: (text: string) => string
  readonly yellow: (text: string) => string
  readonly green: (text: string) => string
}

const ansi = (open: number, close: number) => (text: string) =>
  `\u001b[${open}m${text}\u001b[${close}m`

const plain = (text: string) => text

export const styleFor = (color: boolean): Style =>
  color
    ? {
        bold: ansi(1, 22),
        dim: ansi(2, 22),
        red: ansi(31, 39),
        yellow: ansi(33, 39),
        green: ansi(32, 39),
      }
    : { bold: plain, dim: plain, red: plain, yellow: plain, green: plain }
