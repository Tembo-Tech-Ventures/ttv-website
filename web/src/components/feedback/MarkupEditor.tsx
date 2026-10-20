import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PiArrowCounterClockwiseBold,
  PiPencilSimpleBold,
  PiSquareBold,
} from "react-icons/pi";
import { canvasToBlob } from "./feedback-client";

type Point = readonly [number, number];
type Shape =
  | { tool: "pen"; points: Point[] }
  | { tool: "box"; from: Point; to: Point };
type Tool = Shape["tool"];

/** Bright enough to read on both the dark app and a white screenshot. */
const INK = "#FF3B30";

export function strokeWidthFor(imageWidth: number): number {
  return Math.max(3, Math.round(imageWidth / 300));
}

function drawShape(context: CanvasRenderingContext2D, shape: Shape) {
  context.beginPath();
  if (shape.tool === "box") {
    const [x0, y0] = shape.from;
    const [x1, y1] = shape.to;
    context.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
  } else {
    shape.points.forEach(([x, y], index) =>
      index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)
    );
  }
  context.stroke();
}

/**
 * Draw on a screenshot to point at the problem: a freehand pen and a box.
 * The canvas holds the image at full resolution and is scaled down by CSS, so
 * the exported file loses no detail.
 */
export default function MarkupEditor({
  image,
  onCancel,
  onDone,
}: {
  image: Blob;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const drawingRef = useRef<Shape | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>("box");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  const redraw = useCallback(
    (extra: Shape | null = drawingRef.current) => {
      const canvas = canvasRef.current;
      const bitmap = bitmapRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !bitmap || !context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0);
      context.strokeStyle = INK;
      context.lineWidth = strokeWidthFor(canvas.width);
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const shape of extra ? [...shapes, extra] : shapes) drawShape(context, shape);
    },
    [shapes]
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const bitmap = await createImageBitmap(image);
      if (cancelled) {
        bitmap.close();
        return;
      }
      bitmapRef.current = bitmap;
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      setReady(true);
    }
    void load();
    return () => {
      cancelled = true;
      bitmapRef.current?.close();
      bitmapRef.current = null;
    };
  }, [image]);

  // Redraw whenever the committed shapes change or the image arrives.
  useEffect(() => {
    if (ready) redraw();
  }, [redraw, ready]);

  function toImagePoint(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * canvas.width,
      ((event.clientY - rect.top) / rect.height) * canvas.height,
    ];
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!ready) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = toImagePoint(event);
    drawingRef.current =
      tool === "pen" ? { tool, points: [point] } : { tool, from: point, to: point };
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const current = drawingRef.current;
    if (!current) return;
    const point = toImagePoint(event);
    drawingRef.current =
      current.tool === "pen"
        ? { ...current, points: [...current.points, point] }
        : { ...current, to: point };
    redraw();
  }

  function onPointerUp() {
    const finished = drawingRef.current;
    drawingRef.current = null;
    if (finished) setShapes((previous) => [...previous, finished]);
  }

  async function finish() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (shapes.length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    try {
      onDone(await canvasToBlob(canvas));
    } finally {
      setSaving(false);
    }
  }

  const toolButton = (value: Tool, label: string, Icon: typeof PiPencilSimpleBold) => (
    <button
      type="button"
      aria-pressed={tool === value}
      onClick={() => setTool(value)}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        tool === value
          ? "bg-primary text-dark"
          : "text-ink-secondary hover:bg-ink-primary/[0.06] hover:text-ink-primary"
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="feedback-markup">
      <p className="text-sm text-ink-secondary">
        Circle or box the part you mean. It helps more than you'd think.
      </p>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-rule bg-dark/60 p-1">
        {toolButton("box", "Box", PiSquareBold)}
        {toolButton("pen", "Pen", PiPencilSimpleBold)}
        <button
          type="button"
          onClick={() => setShapes((previous) => previous.slice(0, -1))}
          disabled={shapes.length === 0}
          className="ml-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-ink-secondary transition-colors hover:text-ink-primary disabled:opacity-40"
        >
          <PiArrowCounterClockwiseBold className="h-4 w-4" aria-hidden="true" />
          Undo
        </button>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Screenshot. Drag to draw on it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="mx-auto block h-auto max-h-[55dvh] w-auto max-w-full cursor-crosshair touch-none rounded-md border border-rule"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-4 py-2 text-sm text-ink-secondary hover:text-ink-primary"
        >
          Keep as is
        </button>
        <button
          type="button"
          onClick={() => void finish()}
          disabled={!ready || saving}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-dark transition-colors hover:bg-primary/90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Done"}
        </button>
      </div>
    </div>
  );
}
