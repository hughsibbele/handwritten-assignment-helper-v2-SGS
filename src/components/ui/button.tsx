import * as React from "react";
import { cn } from "@/lib/utils";

const variantClasses = {
  default:
    "bg-maroon text-white hover:bg-maroon-dark",
  outline:
    "border-light-blue bg-white hover:bg-paper hover:text-ink",
  secondary:
    "bg-light-blue text-cool-gray hover:bg-light-blue/80",
  ghost:
    "hover:bg-paper hover:text-ink",
  destructive:
    "bg-red-600/10 text-red-600 hover:bg-red-600/20",
  link: "text-maroon underline-offset-4 hover:underline",
} as const;

const sizeClasses = {
  default: "h-8 gap-1.5 px-2.5",
  sm: "h-7 gap-1 rounded-md px-2.5 text-[0.8rem]",
  lg: "h-9 gap-1.5 px-3",
  icon: "size-8",
  "icon-sm": "size-7 rounded-md",
} as const;

export type ButtonVariants = {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
};

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"button"> & ButtonVariants) {
  return (
    <button
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-maroon focus-visible:ring-2 focus-visible:ring-maroon/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}

function buttonVariants({
  variant = "default",
  size = "default",
  className,
}: ButtonVariants & { className?: string } = {}) {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-maroon focus-visible:ring-2 focus-visible:ring-maroon/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    variantClasses[variant ?? "default"],
    sizeClasses[size ?? "default"],
    className,
  );
}

export { Button, buttonVariants };
