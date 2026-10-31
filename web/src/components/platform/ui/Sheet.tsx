import type { ReactNode } from "react";
import { cx } from "./cx";
import type { Space } from "./spaces";
import "./platform-ui.css";

type SheetProps = {
  /** Whose sheet this is. The tone follows the space. */
  space: Space;
  children: ReactNode;
  as?: "div" | "section" | "main" | "article";
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
};

/**
 * The page a space is written on: a broad sheet with rounded top corners in
 * the space's tone. Under a tab row, use `SpaceFile`, which fuses the two.
 */
export default function Sheet({ space, children, as: Tag = "div", className, ...rest }: SheetProps) {
  return (
    <Tag {...rest} data-sheet={space} data-space-tone={space} className={cx("platform-sheet", className)}>
      {children}
    </Tag>
  );
}
