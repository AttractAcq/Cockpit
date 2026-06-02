import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "subtle" | "ghost";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-teal text-ink border-teal font-medium hover:bg-[#33ebd0]",
  secondary:
    "bg-transparent text-paper border-line hover:border-line-2 hover:bg-ink-50",
  subtle:
    "bg-transparent text-paper-2 border-transparent hover:text-paper hover:bg-ink-50",
  ghost:
    "bg-transparent text-paper-2 border-transparent hover:text-paper",
};

const sizes: Record<Size, string> = {
  sm: "text-xs px-2 py-1",
  md: "text-xs px-2.5 py-1.5",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`rounded-[5px] border cursor-pointer transition-colors leading-none ${variants[variant]} ${sizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
