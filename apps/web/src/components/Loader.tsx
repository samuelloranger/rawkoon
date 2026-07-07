interface LoaderProps {
  size?: "sm" | "md" | "lg";
}

/** Animated loading indicator (three bouncing dots). */
export function Loader({ size = "md" }: LoaderProps) {
  const textClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div
        className={`${textClasses[size]} text-neutral-400 text-[50px] font-medium`}
      >
        <span className="inline-flex w-6 justify-start">
          <span
            className="animate-bounce"
            style={{ animationDelay: "0ms", animationDuration: "1s" }}
          >
            .
          </span>
          <span
            className="animate-bounce"
            style={{ animationDelay: "150ms", animationDuration: "1s" }}
          >
            .
          </span>
          <span
            className="animate-bounce"
            style={{ animationDelay: "300ms", animationDuration: "1s" }}
          >
            .
          </span>
        </span>
      </div>
    </div>
  );
}
