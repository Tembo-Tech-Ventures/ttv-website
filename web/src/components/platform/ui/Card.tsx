import type { ReactNode } from "react";
import { cx } from "./cx";
import { RAISED } from "./tones";

type CardProps = {
  children: ReactNode;
  as?: "div" | "article" | "section" | "li" | "aside";
  padding?: "sm" | "md";
  className?: string;
  "aria-labelledby"?: string;
};

const PADDING = { sm: "p-3", md: "p-4 sm:p-5" };

/**
 * A raised surface on a sheet: an embed, a request, a profile summary. It is
 * a faint lift in the sheet's own light, never a new colour, so it reads as
 * part of the space it sits in.
 */
export default function Card({ children, as: Tag = "div", padding = "md", className, ...rest }: CardProps) {
  return (
    <Tag
      {...rest}
      data-card
      className={cx("rounded-[1.125rem] border border-hairline", RAISED, PADDING[padding], className)}
    >
      {children}
    </Tag>
  );
}
