"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, FormMessage, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import { boxFromPoints, clampBox, hitTest, pixelGrid, type RedactionBox } from "@/lib/proof-admin/redaction";
import { approveScreenshot, saveRedactions } from "../../actions";

type Point = { x: number; y: number };
type Drag =
  | { kind: "draw"; start: Point; current: Point; pointerId: number }
  | { kind: "move"; index: number; offset: Point; pointerId: number; moved: boolean };

/** Theme tokens for drawing on the canvas (CSS variables can't be used there directly). */
function token(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

const ZOOMS = [
  { value: 1, label: "Fit to width" },
  { value: 2, label: "200%" },
  { value: 3, label: "300%" },
];

/**
 * Redaction tool. Draw boxes with mouse, pen or touch, or add and edit them
 * with the number fields. The preview pixelates inside each box the same way
 * the server will; the server re-renders from the original on approval, so
 * this preview is never what gets published.
 */
export function RedactionTool({
  id,
  src,
  width,
  height,
  initialBoxes,
  status,
}: {
  id: string;
  src: string;
  width: number;
  height: number;
  initialBoxes: RedactionBox[];
  status: "pending" | "approved" | "rejected";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState<"loading" | "ok" | "error">("loading");
  const [boxes, setBoxes] = useState<RedactionBox[]>(initialBoxes);
  const [savedJson, setSavedJson] = useState(JSON.stringify(initialBoxes));
  const [selected, setSelected] = useState<number>(-1);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState(true);
  const [drawing, setDrawing] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [announce, setAnnounce] = useState("");
  const [newBox, setNewBox] = useState({ x: "0", y: "0", w: String(Math.min(240, width)), h: String(Math.min(48, height)) });
  const [newBoxError, setNewBoxError] = useState<string | null>(null);

  const [saveState, saveAction] = useActionState<ActionState, FormData>(saveRedactions, null);
  const [approveState, approveAction] = useActionState<ActionState, FormData>(approveScreenshot, null);
  const boxesJson = JSON.stringify(boxes);
  const dirty = boxesJson !== savedJson;

  // After a successful save or approval, the server copy matches.
  const lastSaveState = useRef<ActionState>(null);
  useEffect(() => {
    for (const st of [saveState, approveState]) {
      if (st && st !== lastSaveState.current && st.ok) {
        lastSaveState.current = st;
        setSavedJson(boxesJson);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when a result arrives
  }, [saveState, approveState]);

  // Load the original through its short-lived signed URL.
  useEffect(() => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      imgRef.current = img;
      setLoaded("ok");
    };
    img.onerror = () => setLoaded("error");
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  const lineWidth = Math.max(2, Math.round(Math.max(width, height) / 500));

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const accent = token("--color-accent", "#0b6b45");
    const ink = token("--color-ink", "#12211b");

    const off = document.createElement("canvas");
    const octx = off.getContext("2d");
    boxes.forEach((b, i) => {
      const box = clampBox(b, width, height);
      if (!box) return;
      if (preview && octx) {
        const { cols, rows } = pixelGrid(box);
        off.width = cols;
        off.height = rows;
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = "high";
        octx.drawImage(img, box.x, box.y, box.w, box.h, 0, 0, cols, rows);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, cols, rows, box.x, box.y, box.w, box.h);
        ctx.imageSmoothingEnabled = true;
      }
      const isSel = i === selected;
      ctx.lineWidth = isSel ? lineWidth * 2 : lineWidth;
      ctx.setLineDash(isSel ? [] : [lineWidth * 3, lineWidth * 2]);
      ctx.strokeStyle = isSel ? accent : ink;
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.setLineDash([]);
      // number label
      const fs = Math.max(12, lineWidth * 7);
      ctx.font = `600 ${fs}px sans-serif`;
      const label = String(i + 1);
      const lw = ctx.measureText(label).width + fs * 0.6;
      ctx.fillStyle = isSel ? accent : ink;
      ctx.fillRect(box.x, box.y, lw, fs * 1.4);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(label, box.x + fs * 0.3, box.y + fs * 1.05);
    });

    if (drag?.kind === "draw") {
      const d = boxFromPoints(drag.start, drag.current);
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = accent;
      ctx.fillRect(d.x, d.y, d.w, d.h);
      ctx.globalAlpha = 1;
      ctx.lineWidth = lineWidth;
      ctx.strokeStyle = accent;
      ctx.strokeRect(d.x, d.y, d.w, d.h);
    }
  }, [boxes, selected, drag, preview, width, height, lineWidth]);

  useEffect(() => {
    if (loaded === "ok") draw();
  }, [loaded, draw]);

  function toImage(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(width, Math.max(0, ((e.clientX - rect.left) * width) / rect.width)),
      y: Math.min(height, Math.max(0, ((e.clientY - rect.top) * height) / rect.height)),
    };
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || loaded !== "ok" || (e.pointerType === "mouse" && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toImage(e);
    const hit = hitTest(boxes, p);
    if (hit >= 0) {
      setSelected(hit);
      setDrag({ kind: "move", index: hit, offset: { x: p.x - boxes[hit].x, y: p.y - boxes[hit].y }, pointerId: e.pointerId, moved: false });
    } else {
      setDrag({ kind: "draw", start: p, current: p, pointerId: e.pointerId });
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const p = toImage(e);
    if (drag.kind === "draw") {
      setDrag({ ...drag, current: p });
    } else {
      const b = boxes[drag.index];
      const x = Math.round(Math.min(width - b.w, Math.max(0, p.x - drag.offset.x)));
      const y = Math.round(Math.min(height - b.h, Math.max(0, p.y - drag.offset.y)));
      setBoxes((prev) => prev.map((bb, i) => (i === drag.index ? { ...bb, x, y } : bb)));
      if (!drag.moved) setDrag({ ...drag, moved: true });
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === "draw") {
      const box = clampBox(boxFromPoints(drag.start, toImage(e)), width, height);
      if (box) {
        setBoxes((prev) => [...prev, box]);
        setSelected(boxes.length);
        setAnnounce(`Box ${boxes.length + 1} added.`);
      } else {
        setSelected(-1);
      }
    }
    setDrag(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (selected < 0 || selected >= boxes.length) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    if (moves[e.key]) {
      e.preventDefault();
      setBoxes((prev) =>
        prev.map((b, i) =>
          i === selected
            ? { ...b, x: Math.min(width - b.w, Math.max(0, b.x + moves[e.key].x)), y: Math.min(height - b.h, Math.max(0, b.y + moves[e.key].y)) }
            : b,
        ),
      );
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeBox(selected);
    } else if (e.key === "Escape") {
      setSelected(-1);
    }
  }

  function removeBox(i: number) {
    setBoxes((prev) => prev.filter((_, j) => j !== i));
    setSelected(-1);
    setAnnounce(`Box ${i + 1} removed.`);
  }

  function updateField(i: number, key: keyof RedactionBox, raw: string) {
    const v = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(v)) return;
    setBoxes((prev) => prev.map((b, j) => (j === i ? { ...b, [key]: Math.round(v) } : b)));
  }

  function clampField(i: number) {
    setBoxes((prev) => prev.map((b, j) => (j === i ? (clampBox(b, width, height) ?? b) : b)));
  }

  function addFromInputs() {
    const box = clampBox({ x: Number(newBox.x), y: Number(newBox.y), w: Number(newBox.w), h: Number(newBox.h) }, width, height);
    if (!box) {
      setNewBoxError(`Enter numbers inside the image (${width} × ${height}); width and height at least 4.`);
      return;
    }
    setNewBoxError(null);
    setBoxes((prev) => [...prev, box]);
    setSelected(boxes.length);
    setAnnounce(`Box ${boxes.length + 1} added.`);
  }

  const numberInput = "block min-h-10 w-full rounded-md border border-ink/25 bg-card px-2 py-1 tabular-nums";

  return (
    <div className="space-y-6">
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Button variant={drawing ? "primary" : "secondary"} aria-pressed={drawing} onClick={() => setDrawing((d) => !d)}>
          Draw on image{drawing ? ": on" : ": off"}
        </Button>
        <label className="flex min-h-10 items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-accent" checked={preview} onChange={(e) => setPreview(e.currentTarget.checked)} />
          Show pixelation preview
        </label>
        <div>
          <label htmlFor="rt-zoom" className="mb-1 block text-sm font-medium">
            Zoom
          </label>
          <select id="rt-zoom" value={zoom} onChange={(e) => setZoom(Number(e.currentTarget.value))} className="block min-h-10 rounded-md border border-ink/25 bg-card px-3 py-2 text-sm">
            {ZOOMS.map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-ink-muted">
          {boxes.length} box{boxes.length === 1 ? "" : "es"}
          {dirty && <span className="ml-2 font-semibold text-ink">· Unsaved changes</span>}
        </p>
      </div>

      <div className="max-h-[75vh] overflow-auto rounded-lg border border-line bg-paper">
        {loaded === "error" ? (
          <p role="alert" className="p-6 text-sm text-danger">
            The original couldn&apos;t be loaded (the private link lasts 10 minutes). Reload the page to get a fresh one.
          </p>
        ) : (
          <>
            {loaded === "loading" && <p className="p-6 text-sm text-ink-muted">Loading the original…</p>}
            <canvas
              ref={canvasRef}
              width={width}
              height={height}
              tabIndex={0}
              role="img"
              aria-label={`Screenshot with ${boxes.length} redaction boxes. ${selected >= 0 ? `Box ${selected + 1} selected: arrow keys move it, Shift for bigger steps, Delete removes it.` : "Use the box fields below to add boxes with the keyboard."}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={onKeyDown}
              style={{ width: `${zoom * 100}%`, touchAction: drawing ? "none" : "auto", cursor: drawing ? "crosshair" : "default" }}
              className={`block h-auto max-w-none ${loaded === "ok" ? "" : "hidden"}`}
            />
          </>
        )}
      </div>
      <p className="text-sm text-ink-muted">
        Drag on the image to draw a box over anything identifying. Drag a box to move it. Turn drawing off to scroll the image on a phone.
      </p>

      <section aria-labelledby="rt-boxes" className="space-y-3">
        <h2 id="rt-boxes" className="text-lg font-semibold">
          Boxes (pixels; image is {width} × {height})
        </h2>
        {boxes.length === 0 && <p className="text-sm text-ink-muted">No boxes yet.</p>}
        <ol className="space-y-3">
          {boxes.map((b, i) => (
            <li key={i}>
              <fieldset
                className={`rounded-lg border p-3 ${i === selected ? "border-accent bg-accent-soft" : "border-line bg-card"}`}
                onFocus={() => setSelected(i)}
              >
                <legend className="px-1 text-sm font-semibold">Box {i + 1}</legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
                  {(["x", "y", "w", "h"] as const).map((k) => (
                    <div key={k}>
                      <label htmlFor={`box-${i}-${k}`} className="mb-1 block text-xs font-medium">
                        {{ x: "Left (x)", y: "Top (y)", w: "Width", h: "Height" }[k]}
                      </label>
                      <input
                        id={`box-${i}-${k}`}
                        type="number"
                        inputMode="numeric"
                        min={k === "w" || k === "h" ? 4 : 0}
                        max={k === "x" || k === "w" ? width : height}
                        value={b[k]}
                        onChange={(e) => updateField(i, k, e.currentTarget.value)}
                        onBlur={() => clampField(i)}
                        className={numberInput}
                      />
                    </div>
                  ))}
                  <Button variant="secondary" className="col-span-2 text-danger sm:col-span-1" onClick={() => removeBox(i)} aria-label={`Remove box ${i + 1}`}>
                    Remove
                  </Button>
                </div>
              </fieldset>
            </li>
          ))}
        </ol>

        <fieldset className="rounded-lg border border-dashed border-ink/25 p-3">
          <legend className="px-1 text-sm font-semibold">Add a box by numbers</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto] sm:items-end">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <div key={k}>
                <label htmlFor={`new-box-${k}`} className="mb-1 block text-xs font-medium">
                  {{ x: "Left (x)", y: "Top (y)", w: "Width", h: "Height" }[k]}
                </label>
                <input
                  id={`new-box-${k}`}
                  type="number"
                  inputMode="numeric"
                  value={newBox[k]}
                  aria-describedby={newBoxError ? "new-box-error" : undefined}
                  onChange={(e) => setNewBox({ ...newBox, [k]: e.currentTarget.value })}
                  className={numberInput}
                />
              </div>
            ))}
            <Button variant="secondary" className="col-span-2 sm:col-span-1" onClick={addFromInputs}>
              Add box
            </Button>
          </div>
          {newBoxError && (
            <p id="new-box-error" className="mt-2 text-sm font-medium text-danger">
              {newBoxError}
            </p>
          )}
        </fieldset>

        <form action={saveAction} className="flex flex-col items-start gap-2">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="boxes" value={boxesJson} />
          <SubmitButton variant="secondary" pendingText="Saving…">
            Save boxes
          </SubmitButton>
          <FormMessage state={saveState} />
        </form>
      </section>

      <section aria-labelledby="rt-approve" className="rounded-lg border border-line bg-card p-5">
        <h2 id="rt-approve" className="text-lg font-semibold">
          {status === "approved" ? "Re-publish with these boxes" : "Approve and publish"}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          The server rebuilds the image from the private original with every box pixelated, then publishes only that copy.
          {boxes.length === 0 && " There are no boxes: make sure nothing on it identifies a buyer."}
        </p>
        <form action={approveAction} className="mt-4 space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="boxes" value={boxesJson} />
          <Checkbox
            id="pii_checked"
            name="pii_checked"
            required
            label="I checked for buyer names, addresses and order numbers"
            error={approveState?.fieldErrors?.pii_checked}
          />
          <FormMessage state={approveState} />
          <SubmitButton pendingText="Rendering and publishing…">{status === "approved" ? "Re-publish" : "Approve and publish"}</SubmitButton>
        </form>
      </section>
    </div>
  );
}
