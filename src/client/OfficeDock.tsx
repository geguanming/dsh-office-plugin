import { useEffect, useRef, useState } from 'react'
import { OfficeCanvas, type OfficeCanvasProps } from './OfficeCanvas.tsx'

const KEYFRAMES = `
@keyframes dsh-office-dock-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}`

const MIN_W = 320
const MAX_W_FRAC = 0.92
// 对话区挤压：仿 dsh-better-sidebar 的 layout.css，给 #root 加 margin-right 让中栏让位
const WIDTH_VAR = '--dsh-office-width'
const DRAGGING_ATTR = 'data-dsh-office-dragging'
const LAYOUT_STYLE_ID = 'dsh-office-dock-layout'

/**
 * 右侧滑出面板：顶部栏（标题 + 关闭）+ 办公室画布。fixed 定位在窗口右缘，
 * 同时通过 #root 的 margin-right 让对话区（中栏）让出宽度而非被覆盖。
 */
export function OfficeDock(props: OfficeCanvasProps & { onClose: () => void }): React.ReactElement {
  const { onClose, ...canvasProps } = props
  // 每次点开默认展开屏幕的 70%；拖动只在本次会话内生效
  const [width, setWidth] = useState(() => Math.round(window.innerWidth * 0.7))
  const [hovered, setHovered] = useState(false)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startWidth: width })
  const latestRef = useRef(width)
  const frameRef = useRef<number | null>(null)

  // 注入对话区挤压样式（挂载一次，卸载清理）；#root 的 margin-right 跟随面板宽度
  useEffect(() => {
    const style = document.createElement('style')
    style.id = LAYOUT_STYLE_ID
    style.textContent = `#root {
  margin-right: var(${WIDTH_VAR}, 0px);
  width: calc(100% - var(${WIDTH_VAR}, 0px));
  transition: margin-right 0.18s ease, width 0.18s ease;
}
body[${DRAGGING_ATTR}] #root { transition: none; }`
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])
  useEffect(() => {
    document.documentElement.style.setProperty(WIDTH_VAR, `${width}px`)
    return () => { document.documentElement.style.removeProperty(WIDTH_VAR) }
  }, [width])

  const clampWidth = (w: number): number =>
    Math.min(Math.max(MIN_W, w), Math.max(MIN_W, Math.round(window.innerWidth * MAX_W_FRAC)))

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startX: e.clientX, startWidth: width }
    setDragging(true)
    document.body.setAttribute(DRAGGING_ATTR, '')
  }
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latestRef.current = clampWidth(dragRef.current.startWidth + (dragRef.current.startX - e.clientX))
    frameRef.current ??= requestAnimationFrame(() => {
      frameRef.current = null
      setWidth(latestRef.current)
    })
  }
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frameRef.current !== null) { cancelAnimationFrame(frameRef.current); frameRef.current = null }
    setWidth(latestRef.current)
    setDragging(false)
    document.body.removeAttribute(DRAGGING_ATTR)
  }

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width,
          background: '#FFFFFF',
          boxShadow: '-6px 0 28px rgba(0,0,0,0.22)',
          zIndex: 2147483000,
          display: 'flex',
          flexDirection: 'column',
          animation: 'dsh-office-dock-in 0.22s ease-out',
        }}
      >
        <div
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          style={{
            position: 'absolute',
            left: -6,
            top: 0,
            bottom: 0,
            width: 14,
            cursor: 'ew-resize',
            zIndex: 20,
            touchAction: 'none',
          }}
          data-dragging={dragging || undefined}
        >
          <div
            style={{
              position: 'absolute',
              left: 6,
              top: 0,
              bottom: 0,
              width: 2,
              borderRadius: 1,
              background: dragging ? 'rgba(150,120,80,0.7)' : hovered ? 'rgba(150,120,80,0.45)' : 'rgba(150,120,80,0.16)',
              transition: 'background 0.15s',
            }}
          />
        </div>
        <div
          style={{
            flex: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 14px',
            height: 44,
            borderBottom: '1px solid var(--dsw-alias-border-l2, #ECE6DB)',
            background: 'var(--dsw-bg-card, #FAF7F1)',
          }}
        >
          <span style={{ fontSize: 15 }}>🏢</span>
          <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--dsw-alias-label-primary, #4A4034)', flex: 1 }}>实景办公室</span>
          <button
            type="button"
            onClick={onClose}
            title="关闭"
            aria-label="关闭实景办公室"
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--dsw-alias-label-tertiary, #8A7A63)',
              cursor: 'pointer',
              width: 28,
              height: 28,
              borderRadius: 6,
              fontSize: 15,
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <OfficeCanvas {...canvasProps} />
        </div>
      </div>
    </>
  )
}
