import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  primary: {
    background: "var(--aurum-gold)",
    color: "#0a0a0b",
    border: "1px solid transparent",
  },
  secondary: {
    background: "var(--aurum-charcoal)",
    color: "var(--aurum-text)",
    border: "1px solid var(--aurum-border-strong)",
  },
  ghost: {
    background: "transparent",
    color: "var(--aurum-text-muted)",
    border: "1px solid transparent",
  },
  danger: {
    background: "transparent",
    color: "var(--aurum-danger)",
    border: "1px solid rgba(196, 92, 92, 0.35)",
  },
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  sm: { padding: "6px 12px", fontSize: "13px" },
  md: { padding: "9px 16px", fontSize: "14px" },
  lg: { padding: "12px 20px", fontSize: "15px" },
};

export function Button({
  variant = "secondary",
  size = "md",
  children,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className="aurum-focus-ring"
      disabled={disabled}
      style={{
        fontFamily: "var(--aurum-font-body)",
        fontWeight: 500,
        borderRadius: "var(--aurum-radius-sm)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition:
          "background var(--aurum-duration) var(--aurum-ease), color var(--aurum-duration) var(--aurum-ease), border-color var(--aurum-duration) var(--aurum-ease)",
        letterSpacing: "0.01em",
        ...variantStyles[variant],
        ...sizeStyles[size],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
