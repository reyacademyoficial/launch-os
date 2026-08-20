import { type InputHTMLAttributes, forwardRef } from "react";

type Props = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { className = "", type = "text", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={
        "w-full rounded-md border border-border bg-input px-3 py-2 text-base sm:text-sm " +
        "text-fg placeholder:text-fg-subtle " +
        "focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent " +
        "disabled:cursor-not-allowed disabled:opacity-50 " +
        className
      }
      {...rest}
    />
  );
});
