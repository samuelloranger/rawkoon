import * as React from "react";
import { cn } from "@/lib/utils";

type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        "h-4 w-4 rounded border cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 border-primary-700 accent-primary-500",
        className,
      )}
      {...props}
    />
  ),
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
