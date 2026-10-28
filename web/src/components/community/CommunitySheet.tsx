import React, { type CSSProperties, type ReactNode } from "react";

/** React server-rendered counterpart of homepage/Sheet.astro, using its CSS and motion. */
export default function CommunitySheet({ children, tone, layer, className, id, labelledby, last = false }: {
  children: ReactNode;
  tone: "base" | "map" | "raised" | "lift" | "peach" | "deep";
  layer: number;
  className: string;
  id?: string;
  labelledby: string;
  last?: boolean;
}) {
  return <section id={id} aria-labelledby={labelledby} className={`hp-sheet hp-sheet--${tone}${last ? " hp-sheet--last" : ""}`} data-hp-sheet style={{ "--hp-layer": layer } as CSSProperties}>
    <div className={`hp-sheet__body ${className}`}>{children}</div>
    <div className="hp-sheet__dim" aria-hidden="true" data-hp-dim />
  </section>;
}
