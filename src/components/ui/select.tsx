import { type SelectHTMLAttributes, forwardRef } from "react";

type Props = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className = "", children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={
        "w-full rounded-md border border-border bg-input px-3 py-2 text-sm " +
        "text-fg focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent " +
        "disabled:cursor-not-allowed disabled:opacity-50 " +
        className
      }
      {...rest}
    >
      {children}
    </select>
  );
});
