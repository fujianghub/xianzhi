/** e2e 里读取应用暴露的调试句柄（src/client/hooks/useRealtime.ts 的 window.__gi.realtime）。 */
export {}

declare global {
  interface Window {
    __gi?: {
      realtime?: {
        status: string
        lastEventId: string | null
        frames: number
        close: () => void
        reconnect: () => void
      }
    }
  }
}
