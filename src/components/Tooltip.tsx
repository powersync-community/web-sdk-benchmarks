import { useId, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  label?: string;
  variant?: "inline" | "corner";
}

export function Tooltip({
  content,
  label = "More info",
  variant = "inline",
}: TooltipProps) {
  const id = useId();
  const className = variant === "corner" ? "tooltip tooltip--corner" : "tooltip";
  return (
    <span className={className}>
      <button
        type="button"
        className="tooltip-trigger"
        aria-label={label}
        aria-describedby={id}
        onClick={(e) => e.stopPropagation()}
      >
        i
      </button>
      <span role="tooltip" id={id} className="tooltip-content">
        {content}
      </span>
    </span>
  );
}
