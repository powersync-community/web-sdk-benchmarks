import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

interface TooltipProps {
  content: ReactNode;
  label?: string;
  variant?: "inline" | "corner";
}

/** Gap between the trigger and the tooltip box. */
const GAP = 8;
/** Minimum distance the tooltip keeps from the viewport edge. */
const VIEWPORT_MARGIN = 8;
/** Hard cap on tooltip width (matches the original design). */
const MAX_WIDTH = 260;

export function Tooltip({
  content,
  label = "More info",
  variant = "inline",
}: TooltipProps) {
  const id = useId();
  const className = variant === "corner" ? "tooltip tooltip--corner" : "tooltip";

  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});
  const [placement, setPlacement] = useState<"top" | "bottom">("top");

  // Measure the trigger + tooltip and pin the tooltip inside the viewport.
  const position = useCallback(() => {
    const trigger = triggerRef.current;
    const tip = contentRef.current;
    if (!trigger || !tip) return;

    const t = trigger.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;

    // Prefer above; flip below when there isn't room for the box + gap.
    const fitsAbove = t.top >= box.height + GAP + VIEWPORT_MARGIN;
    const fitsBelow = vh - t.bottom >= box.height + GAP + VIEWPORT_MARGIN;
    const place: "top" | "bottom" = fitsAbove || !fitsBelow ? "top" : "bottom";

    // Clamp vertically too, so a tall tooltip that fits neither above nor
    // below the trigger still keeps its top edge on-screen rather than clipping.
    const rawTop = place === "top" ? t.top - box.height - GAP : t.bottom + GAP;
    const maxTop = vh - box.height - VIEWPORT_MARGIN;
    const top = Math.max(VIEWPORT_MARGIN, Math.min(rawTop, maxTop));

    // Center on the trigger, then clamp horizontally into the viewport.
    const center = t.left + t.width / 2;
    const maxLeft = vw - box.width - VIEWPORT_MARGIN;
    const left = Math.max(VIEWPORT_MARGIN, Math.min(center - box.width / 2, maxLeft));

    // Arrow tracks the trigger centre, kept within the box's rounded corners.
    const arrowLeft = Math.max(10, Math.min(center - left, box.width - 10));

    setPlacement(place);
    setStyle({
      position: "fixed",
      top,
      left,
      maxWidth: Math.min(MAX_WIDTH, vw - VIEWPORT_MARGIN * 2),
      ["--arrow-left" as string]: `${arrowLeft}px`,
    });
  }, []);

  // Recompute on open, and keep it pinned while open if the page scrolls/resizes.
  useLayoutEffect(() => {
    if (!open) return;
    position();
    window.addEventListener("scroll", position, true);
    window.addEventListener("resize", position);
    return () => {
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("resize", position);
    };
  }, [open, position]);

  return (
    <span
      className={className}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        type="button"
        className="tooltip-trigger"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        onClick={(e) => e.stopPropagation()}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      <span
        ref={contentRef}
        role="tooltip"
        id={id}
        className={`tooltip-content tooltip-content--${placement}${
          open ? " tooltip-content--open" : ""
        }`}
        style={style}
      >
        {content}
      </span>
    </span>
  );
}
