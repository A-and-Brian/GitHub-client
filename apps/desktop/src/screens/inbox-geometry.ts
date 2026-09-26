import type { HTMLAttributes } from "react"
import { useRef, useState, useSyncExternalStore } from "react"

const WIDTH_KEY = "github-client.inbox-width.v1"
const DEFAULT_WIDTH = 256
const MIN_WIDTH = 208
const DETAIL_WIDTH = 640

function subscribe(listener: () => void) {
  window.addEventListener("resize", listener)
  return () => window.removeEventListener("resize", listener)
}

function savedWidth() {
  try {
    const width = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(width) && width >= MIN_WIDTH ? width : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

/** Keep the requested width when a small window temporarily clamps it. */
export function useInboxGeometry() {
  const viewport = useSyncExternalStore(subscribe, () => window.innerWidth)
  const [requestedWidth, setRequestedWidth] = useState(savedWidth)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const maximum = Math.max(MIN_WIDTH, viewport - DETAIL_WIDTH)
  const width = Math.max(MIN_WIDTH, Math.min(maximum, requestedWidth))
  const mobile = viewport < MIN_WIDTH + DETAIL_WIDTH
  const save = (next: number) => {
    const value = Math.max(MIN_WIDTH, Math.min(maximum, next))
    setRequestedWidth(value)
    try {
      localStorage.setItem(WIDTH_KEY, String(value))
    } catch {
      // Resizing remains available when browser storage is disabled.
    }
  }
  const separatorProps: HTMLAttributes<HTMLDivElement> = {
    role: "separator",
    tabIndex: 0,
    "aria-label": "Resize inbox sidebar",
    "aria-orientation": "vertical",
    "aria-valuemin": MIN_WIDTH,
    "aria-valuemax": maximum,
    "aria-valuenow": width,
    onPointerDown(event) {
      if (event.button !== 0 || !event.isPrimary) return
      drag.current = { x: event.clientX, width }
      event.currentTarget.setPointerCapture(event.pointerId)
      event.preventDefault()
    },
    onPointerMove(event) {
      if (!drag.current) return
      if (!(event.buttons & 1)) {
        drag.current = null
        return
      }
      save(drag.current.width + event.clientX - drag.current.x)
    },
    onPointerUp() {
      drag.current = null
    },
    onPointerCancel() {
      drag.current = null
    },
    onLostPointerCapture() {
      drag.current = null
    },
    onDoubleClick() {
      save(DEFAULT_WIDTH)
    },
    onKeyDown(event) {
      if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return
      event.preventDefault()
      save(event.key === "Home" ? DEFAULT_WIDTH : width + (event.key === "ArrowLeft" ? -16 : 16))
    },
  }
  return { width, mobile, separatorProps }
}
