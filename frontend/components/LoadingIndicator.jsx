import { ConcentricRing } from "./loading-ui/concentric-ring";
import { cn } from "../lib/utils";

// One adapter for every pending state. Scoped CSS supplies the registry
// component's utility styles in this project's plain-CSS frontend.
// Beside visible status text the ring is decorative, so buttons keep their name.
export function LoadingIndicator({
  size = 16,
  label,
  className,
  style,
  ...props
}) {
  return (
    <ConcentricRing
      {...props}
      className={cn("loading-ring", className)}
      style={{ "--loading-size": `${size}px`, ...style }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
