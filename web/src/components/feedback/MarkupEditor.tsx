import React, { useCallback, useEffect, useRef, useState } from "react";
import { PiArrowCounterClockwise, PiPencilSimple, PiSquare } from "react-icons/pi";
import { Button, Pill } from "@/components/platform/ui";
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

  const toolButton = (value: Tool, label: string, Icon: typeof PiPencilSimple) => (
    <Pill pressed={tool === value} onClick={() => setTool(value)}>
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </Pill>
  );

  return (
    <div className="flex flex-col gap-3" data-testid="feedback-markup">
      <p className="text-sm text-ink-secondary">
        Circle or box the part you mean. It helps more than you'd think.
      </p>
      <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-hairline bg-ground/40 p-1">
        <legend className="sr-only">Drawing tools</legend>
        {toolButton("box", "Box", PiSquare)}
        {toolButton("pen", "Pen", PiPencilSimple)}
        <Button
          variant="ghost"
          size="sm"
          icon={<PiArrowCounterClockwise className="size-4" />}
          onClick={() => setShapes((previous) => previous.slice(0, -1))}
          disabled={shapes.length === 0}
          className="ml-auto"
        >
          Undo
        </Button>
      </fieldset>
      <canvas
        ref={canvasRef}
        aria-label="Screenshot. Drag to draw on it."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="mx-auto block h-auto max-h-[55dvh] w-auto max-w-full cursor-crosshair touch-none rounded-lg border border-hairline"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Keep as is
        </Button>
        <Button variant="primary" onClick={() => void finish()} disabled={!ready} loading={saving}>
          Done
        </Button>
      </div>
    </div>
  );
}
