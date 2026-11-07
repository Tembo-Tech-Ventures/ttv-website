import type { ReactNode } from "react";
import { cx } from "./cx";
import type { Space } from "./spaces";
import "./platform-ui.css";

/**
 * The sheet tones, named for the spaces that wear them. Anything else drawn as
 * a sheet (the style guide's sections, say) borrows one of these rather than
 * mixing a new colour: contrast.test.ts proves every ink on exactly these.
 */
export type SheetTone = Space;

type SheetProps = {
  /** Whose sheet this is. The tone follows the space. */
  space: SheetTone;
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
