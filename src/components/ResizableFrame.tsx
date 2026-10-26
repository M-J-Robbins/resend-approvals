"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import styles from "./ResizableFrame.module.css";

export interface FrameSize {
  width: number;
  height: number;
}

export const FRAME_LIMITS = {
  width: { min: 200, max: 1920 },
  height: { min: 200, max: 2400 },
} as const;

const clamp = (n: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(n)));

type Axis = "x" | "y" | "xy";

/**
 * A box of an exact size with drag handles on its right edge, bottom edge and
 * corner. The box is centred in its stage, so a width change grows both sides:
 * the width moves by twice the pointer, which keeps the edge under the pointer.
 *
 * The handles are pointer-only (keyboard users type the size instead), and
 * the content ignores the pointer during a drag, because an iframe would
 * otherwise swallow the pointer events.
 */
export function ResizableFrame({
  size,
  onResize,
  children,
}: {
  size: FrameSize;
  onResize: (size: FrameSize) => void;
  children: ReactNode;
}) {
  const drag = useRef<{ axis: Axis; x: number; y: number; start: FrameSize } | null>(null);
  const [dragging, setDragging] = useState(false);

  const begin = (axis: Axis) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { axis, x: e.clientX, y: e.clientY, start: size };
    setDragging(true);
  };

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    onResize({
      width: d.axis === "y" ? d.start.width : clamp(d.start.width + 2 * (e.clientX - d.x), FRAME_LIMITS.width),
      height: d.axis === "x" ? d.start.height : clamp(d.start.height + (e.clientY - d.y), FRAME_LIMITS.height),
    });
  };

  const end = () => {
    drag.current = null;
    setDragging(false);
  };

  const handle = (axis: Axis, className: string) => (
    <div
      className={className}
      aria-hidden="true"
      onPointerDown={begin(axis)}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    />
  );

  return (
    <div
      className={styles.frame}
      data-dragging={dragging || undefined}
      style={{ width: size.width, height: size.height }}
    >
      {children}
      {handle("x", styles.edgeX)}
      {handle("y", styles.edgeY)}
      {handle("xy", styles.corner)}
    </div>
  );
}

/**
 * A pixel input that shows the live value (it follows a drag) but lets the
 * reviewer type freely: a value in range applies at once, anything else waits
 * for blur or Enter and is then clamped.
 */
export function PixelInput({
  label,
  value,
  limits,
  onChange,
}: {
  label: string;
  value: number;
  limits: { min: number; max: number };
  onChange: (value: number) => void;
}) {
  // What the reviewer is typing, while they type; otherwise the live value.
  const [editing, setEditing] = useState<string | null>(null);

  const commit = () => {
    if (editing === null) return;
    const n = Number(editing);
    if (editing.trim() !== "" && Number.isFinite(n)) onChange(clamp(n, limits));
    setEditing(null);
  };

  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        className={styles.input}
        min={limits.min}
        max={limits.max}
        step={1}
        value={editing ?? String(value)}
        onChange={(e) => {
          const text = e.target.value;
          setEditing(text);
          const n = Number(text);
          if (text.trim() !== "" && Number.isInteger(n) && n >= limits.min && n <= limits.max) onChange(n);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
      <span className={styles.unit}>px</span>
    </label>
  );
}
