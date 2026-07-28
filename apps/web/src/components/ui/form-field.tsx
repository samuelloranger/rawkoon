import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface FormFieldProps {
  label?: string;
  error?: string;
  required?: boolean;
  className?: string;
  /** id of the control this label points at */
  controlId?: string;
  /** id to give the error message so the control can reference it */
  errorId?: string;
  children: React.ReactNode;
}

function FormField({
  label,
  error,
  required,
  className,
  controlId,
  errorId,
  children,
}: FormFieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label
          htmlFor={controlId}
          className="block text-sm font-medium text-neutral-300"
        >
          {label}
          {required && (
            <span className="text-red-400 ml-1" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

interface FormInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  required?: boolean;
}

export const FormInput = React.forwardRef<HTMLInputElement, FormInputProps>(
  ({ label, error, required, className, id, ...props }, ref) => {
    const generatedId = React.useId();
    const controlId = id ?? generatedId;
    const errorId = `${controlId}-error`;

    return (
      <FormField
        label={label}
        error={error}
        required={required}
        controlId={controlId}
        errorId={errorId}
      >
        <Input
          ref={ref}
          id={controlId}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
          aria-describedby={
            error
              ? cn(errorId, props["aria-describedby"])
              : props["aria-describedby"]
          }
          className={cn(
            error && "border-red-500 focus:ring-red-500",
            className,
          )}
          {...props}
        />
      </FormField>
    );
  },
);
FormInput.displayName = "FormInput";

interface FormTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  required?: boolean;
}

const FormTextarea = React.forwardRef<HTMLTextAreaElement, FormTextareaProps>(
  ({ label, error, required, className, id, ...props }, ref) => {
    const generatedId = React.useId();
    const controlId = id ?? generatedId;
    const errorId = `${controlId}-error`;

    return (
      <FormField
        label={label}
        error={error}
        required={required}
        controlId={controlId}
        errorId={errorId}
      >
        <Textarea
          ref={ref}
          id={controlId}
          aria-required={required ? true : undefined}
          aria-invalid={error ? true : undefined}
          aria-errormessage={error ? errorId : undefined}
          aria-describedby={
            error
              ? cn(errorId, props["aria-describedby"])
              : props["aria-describedby"]
          }
          className={cn(
            error && "border-red-500 focus:ring-red-500",
            className,
          )}
          {...props}
        />
      </FormField>
    );
  },
);
FormTextarea.displayName = "FormTextarea";
