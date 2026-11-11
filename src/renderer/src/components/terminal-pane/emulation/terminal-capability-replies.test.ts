import { describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/headless'
import {
  createTerminalPixelSizeQueryResponder,
  installTerminalCapabilityReplyHandlers
} from './terminal-capability-replies'

function writeTerminal(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve))
}

function createPixelSizeTerminal(
  cssCellWidth: number,
  cssCellHeight: number,
  devicePixelRatio = 1
) {
  const cols = 100
  const rows = 40
  const width = cssCellWidth * devicePixelRatio
  const height = cssCellHeight * devicePixelRatio
  return {
    dimensions: {
      css: {
        cell: { width: cssCellWidth, height: cssCellHeight },
        canvas: { width: cssCellWidth * cols, height: cssCellHeight * rows }
      },
      device: {
        cell: { width, height },
        canvas: { width: width * cols, height: height * rows },
        char: { width, height, top: 0, left: 0 }
      }
    }
  }
}

describe('installTerminalCapabilityReplyHandlers', () => {
  it.each([
    ['OSC 11 then CPR', '\x1b]11;?\x1b\\\x1b[6n', ['osc', 'cpr']],
    ['CPR then OSC 11', '\x1b[6n\x1b]11;?\x1b\\', ['cpr', 'osc']]
  ] as const)('preserves combined query order (%s)', async (_name, input, expectedKinds) => {
    const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true })
    term.options.theme = { background: '#ffffff' }
    const replies: string[] = []
    const disposable = installTerminalCapabilityReplyHandlers({
      terminal: term as never,
      parser: term.parser,
      sendInput: (data) => {
        replies.push(data)
      },
      isReplaying: () => false
    })
    const onData = term.onData((data) => replies.push(data))

    try {
      await writeTerminal(term, input)
      const kinds = replies.map((reply) => (reply.startsWith('\x1b]11;') ? 'osc' : 'cpr'))
      expect(kinds).toEqual(expectedKinds)
    } finally {
      onData.dispose()
      disposable.dispose()
      term.dispose()
    }
  })
})

describe('createTerminalPixelSizeQueryResponder', () => {
  it.each([
    {
      name: 'DPR 2 device pixels',
      width: 8,
      height: 16,
      dpr: 2,
      cellReply: '\x1b[6;32;16t',
      windowReply: '\x1b[4;1280;1600t'
    },
    {
      name: 'fractional device pixels',
      width: 7.8,
      height: 15.6,
      dpr: 2,
      cellReply: '\x1b[6;31;16t',
      windowReply: '\x1b[4;1248;1560t'
    },
    {
      name: 'floored fractional device canvas pixels',
      width: 7.803,
      height: 15.607,
      dpr: 2,
      cellReply: '\x1b[6;31;16t',
      windowReply: '\x1b[4;1248;1560t'
    },
    {
      name: 'unchanged DPR 1 pixels',
      width: 9,
      height: 18,
      dpr: 1,
      cellReply: '\x1b[6;18;9t',
      windowReply: '\x1b[4;720;900t'
    }
  ])(
    'answers window and cell pixel-size reports with $name',
    ({ width, height, dpr, cellReply, windowReply }) => {
      const sendInput = vi.fn<(data: string) => boolean>(() => true)
      const observe = createTerminalPixelSizeQueryResponder(
        createPixelSizeTerminal(width, height, dpr),
        sendInput
      )

      observe('\x1b[14t\x1b[16t')

      expect(sendInput.mock.calls).toEqual([[windowReply], [cellReply]])
    }
  )

  it('does not answer pixel-size queries before the terminal is rendered', () => {
    const sendInput = vi.fn<(data: string) => boolean>(() => true)
    const observe = createTerminalPixelSizeQueryResponder({ dimensions: undefined }, sendInput)

    observe('\x1b[14t\x1b[16t')

    expect(sendInput).not.toHaveBeenCalled()
  })

  it.each([
    [0, 16],
    [8, 0],
    [-8, 16],
    [8, -16],
    [Number.NaN, 16],
    [8, Number.NaN],
    [Infinity, 16],
    [8, Infinity]
  ])('does not answer pixel-size queries with an invalid device cell %s x %s', (width, height) => {
    const sendInput = vi.fn<(data: string) => boolean>(() => true)
    const terminal = createPixelSizeTerminal(8, 16)
    terminal.dimensions.device.cell = { width, height }
    const observe = createTerminalPixelSizeQueryResponder(terminal, sendInput)

    observe('\x1b[14t\x1b[16t')

    expect(sendInput).not.toHaveBeenCalled()
  })

  it('answers only the cell-size query when the device canvas is missing', () => {
    const sendInput = vi.fn<(data: string) => boolean>(() => true)
    const terminal = createPixelSizeTerminal(9, 18)
    Reflect.deleteProperty(terminal.dimensions.device, 'canvas')
    const observe = createTerminalPixelSizeQueryResponder(terminal, sendInput)

    observe('\x1b[14t\x1b[16t')

    expect(sendInput.mock.calls).toEqual([['\x1b[6;18;9t']])
  })

  it.each([
    [Infinity, 720],
    [900, Infinity],
    [Number.NaN, 720],
    [900, Number.NaN],
    [0, 720],
    [900, 0],
    [-1, 720],
    [900, -1],
    [0.5, 720],
    [900, 0.5]
  ])('answers only the cell-size query with an invalid device canvas %s x %s', (width, height) => {
    const sendInput = vi.fn<(data: string) => boolean>(() => true)
    const terminal = createPixelSizeTerminal(9, 18)
    terminal.dimensions.device.canvas = { width, height }
    const observe = createTerminalPixelSizeQueryResponder(terminal, sendInput)

    observe('\x1b[14t\x1b[16t')

    expect(sendInput.mock.calls).toEqual([['\x1b[6;18;9t']])
  })
})
