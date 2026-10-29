import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";
import { Icon, type IconName } from "./Icon";
import styles from "./ui.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
type Look = { variant?: ButtonVariant; size?: ButtonSize; iconOnly?: boolean };

/** Button classes, for links that should look like buttons. */
export const buttonClass = ({ variant = "secondary", size = "md", iconOnly = false }: Look = {}, className?: string) =>
  cx(styles.button, styles[variant], styles[size], iconOnly && styles.iconOnly, className);

type Props = ButtonHTMLAttributes<HTMLButtonElement> & Omit<Look, "iconOnly"> & { icon?: IconName };

/** Icon-only buttons (an `icon` and no children) need an `aria-label`. */
export function Button({ variant, size, icon, className, children, type = "button", ...rest }: Props) {
  return (
    <button type={type} className={buttonClass({ variant, size, iconOnly: !!icon && !children }, className)} {...rest}>
      {icon && <Icon name={icon} size={size === "sm" ? 18 : 20} />}
      {children}
    </button>
  );
}
