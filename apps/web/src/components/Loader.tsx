interface LoaderProps {
  size?: "sm" | "md" | "lg";
  /** Announced to screen readers while the indicator is visible. */
  label?: string;
}

/** Animated loading indicator (three dots pulsing in sequence). */
export function Loader({ size = "md", label = "Loading" }: LoaderProps) {
  const textClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div
      className="flex flex-col items-center justify-center gap-4"
      role="status"
    >
      <div
        className={`${textClasses[size]} text-neutral-400 text-[50px] font-medium`}
        aria-hidden="true"
      >
        <span className="inline-flex w-6 justify-start">
          {[0, 160, 320].map((delay) => (
            <span
              key={delay}
              className="loader-dot"
              style={{ animationDelay: `${delay}ms` }}
            >
              .
            </span>
          ))}
        </span>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
