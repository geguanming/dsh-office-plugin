import { useEffect, useRef, useState } from 'react'
import { OfficeCanvas, type OfficeCanvasProps } from './OfficeCanvas.tsx'

const STORAGE_KEY = 'dsh-office-floating-window-v1'
interface Bounds { x: number; y: number; width: number; height: number }
function clamp(bounds: Bounds): Bounds {
  const maxW = Math.max(1, window.innerWidth - 16), maxH = Math.max(1, window.innerHeight - 16)
  const width = Math.min(maxW, Math.max(Math.min(360, maxW), bounds.width))
  const height = Math.min(maxH, Math.max(Math.min(260, maxH), bounds.height))
  return { width, height, x: Math.max(8, Math.min(bounds.x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(bounds.y, window.innerHeight - height - 8)) }
}
function initialBounds(): Bounds {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Bounds | null
    if (saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite)) return clamp(saved)
  } catch { /* Storage can be unavailable in private/managed browsers. */ }
  return clamp({ x: window.innerWidth - 536, y: window.innerHeight - 416, width: 520, height: 400 })
}

/** Floating office: independent geometry, title drag and two-axis resize. */
export function OfficeDock(props: OfficeCanvasProps & { onClose: () => void }): React.ReactElement {
  const { onClose, ...canvasProps } = props
  const [bounds, setBounds] = useState(initialBounds)
  const latest = useRef(bounds)
  const frame = useRef<number | undefined>(undefined)
  const drag = useRef<{ x: number; y: number; bounds: Bounds; mode: 'move' | 'resize' } | undefined>(undefined)
  const save = (value: Bounds): void => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)) } catch { /* Optional preference. */ }
  }
  useEffect(() => {
    const resize = (): void => { latest.current = clamp(latest.current); setBounds(latest.current) }
    window.addEventListener('resize', resize)
    return () => { window.removeEventListener('resize', resize); if (frame.current !== undefined) cancelAnimationFrame(frame.current) }
  }, [])
  const begin = (event: React.PointerEvent<HTMLElement>, mode: 'move' | 'resize'): void => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button') && mode === 'move') return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, bounds: latest.current, mode }
  }
  const move = (event: React.PointerEvent<HTMLElement>): void => {
    const start = drag.current
    if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.clientX - start.x, dy = event.clientY - start.y
    latest.current = start.mode === 'move'
      ? clamp({ ...start.bounds, x: start.bounds.x + dx, y: start.bounds.y + dy })
      : { ...start.bounds,
        width: Math.min(window.innerWidth - start.bounds.x - 8, Math.max(360, start.bounds.width + dx)),
        height: Math.min(window.innerHeight - start.bounds.y - 8, Math.max(260, start.bounds.height + dy)) }
    frame.current ??= requestAnimationFrame(() => { frame.current = undefined; setBounds(latest.current) })
  }
  const end = (event: React.PointerEvent<HTMLElement>): void => {
    if (!drag.current) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    drag.current = undefined
    if (frame.current !== undefined) { cancelAnimationFrame(frame.current); frame.current = undefined }
    setBounds(latest.current); save(latest.current)
  }
  return (
    <section aria-label="牛马办公室窗口" style={{ position: 'fixed', left: bounds.x, top: bounds.y,
      width: bounds.width, height: bounds.height, zIndex: 2147483000, display: 'flex', flexDirection: 'column',
      background: '#E8DCC8', borderRadius: 12, border: '1px solid #CDBFA9', boxSizing: 'border-box',
      boxShadow: '0 8px 32px rgba(0,0,0,0.22)', overflow: 'hidden' }}>
      <header aria-label="拖动办公室" onPointerDown={event => begin(event, 'move')} onPointerMove={move}
        onPointerUp={end} onPointerCancel={end} style={{ height: 36, flex: 'none', display: 'flex',
          alignItems: 'center', gap: 8, padding: '0 10px', background: '#FAF7F1', borderBottom: '1px solid #DDD3C3',
          cursor: 'move', touchAction: 'none', userSelect: 'none' }}>
        <span>🏢</span><span style={{ flex: 1, fontWeight: 600, fontSize: 13, color: '#4A4034' }}>实景办公室</span>
        <button type="button" onClick={onClose} aria-label="关闭实景办公室" title="关闭"
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#8A7A63', fontSize: 16 }}>✕</button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}><OfficeCanvas {...canvasProps} /></div>
      <div aria-label="调整办公室大小" title="拖动调整宽度和高度" onPointerDown={event => begin(event, 'resize')}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end}
        style={{ position: 'absolute', right: 0, bottom: 0, width: 22, height: 22, cursor: 'nwse-resize',
          touchAction: 'none', zIndex: 30, color: '#8A7A63', display: 'grid', placeItems: 'center' }}>◢</div>
    </section>
  )
}
