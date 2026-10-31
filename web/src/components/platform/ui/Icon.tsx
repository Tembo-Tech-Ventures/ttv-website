import { createElement, isValidElement, type ComponentType, type ReactNode } from "react";

/**
 * An icon slot accepts an element (`<BellSimpleIcon />`, from React) or the
 * icon component itself (`BellSimpleIcon`, from an Astro page, which cannot
 * hand React elements to a React component). Phosphor icons are forwardRef
 * objects, so "component" means a function or any non-element object.
 */
export type IconSource = ReactNode | ComponentType;

function isComponent(icon: IconSource): icon is ComponentType {
  if (typeof icon === "function") return true;
  return typeof icon === "object" && icon !== null && !isValidElement(icon) && !Array.isArray(icon) && "$$typeof" in icon;
}

/** Renders an icon slot, always hidden from assistive technology. */
export default function Icon({ icon }: { icon: IconSource }) {
  if (icon === null || icon === undefined || icon === false) return null;
  return (
    <span aria-hidden="true" className="inline-flex">
      {isComponent(icon) ? createElement(icon) : icon}
    </span>
  );
}
