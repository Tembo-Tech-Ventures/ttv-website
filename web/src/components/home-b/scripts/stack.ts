import { clamp01, navHeight, type Scene } from "./scenes";

/** Fraction of the viewport the page scrolls while a sheet holds before the next arrives. */
const HOLD = 0.3;

/**
 * The page-level stack. Each sheet but the last sticks by its bottom edge (or
 * under the nav when it is shorter than the screen), holds for a beat, then
 * the next sheet slides over it while it scales back and dims.
 */
export function sheetScene(root: HTMLElement): Scene {
  const sheets = [...root.querySelectorAll<HTMLElement>("[data-hb-sheet]")];
  const dims = sheets.map((sheet) => sheet.querySelector<HTMLElement>(":scope > [data-hb-dim]"));
  const progress = sheets.map(() => 0);
  let vh = window.innerHeight;
  let nav = 0;
  let hold = 0;

  return {
    measure() {
      vh = window.innerHeight;
      nav = navHeight();
      hold = Math.round(vh * HOLD);
      root.style.setProperty("--hb-hold", `${hold}px`);
      root.classList.add("hb-stacked");
      sheets.forEach((sheet, index) => {
        if (index === sheets.length - 1) return;
        const stick = Math.min(nav, vh - sheet.offsetHeight);
        sheet.style.setProperty("--hb-stick", `${stick}px`);
        // Recede around the middle of whatever part of the sheet is on screen.
        sheet.style.setProperty("--hb-origin", `${Math.round(vh / 2 - stick)}px`);
      });
    },
    read() {
      for (let index = 0; index < sheets.length - 1; index += 1) {
        const top = sheets[index + 1].getBoundingClientRect().top;
        progress[index] = clamp01((vh + hold - top) / (vh + hold - nav));
      }
    },
    write() {
      const holdShare = hold / (vh + hold - nav);
      for (let index = 0; index < sheets.length - 1; index += 1) {
        const p = progress[index];
        const sheet = sheets[index];
        sheet.style.transform = p > 0 ? `scale(${(1 - 0.06 * p).toFixed(4)})` : "";
        sheet.style.willChange = p > 0 && p < 1 ? "transform" : "";
        const dim = dims[index];
        if (dim) dim.style.opacity = (0.6 * clamp01((p - holdShare) / (1 - holdShare))).toFixed(3);
      }
    },
    destroy() {
      root.classList.remove("hb-stacked");
      root.style.removeProperty("--hb-hold");
      sheets.forEach((sheet, index) => {
        sheet.style.removeProperty("--hb-stick");
        sheet.style.removeProperty("--hb-origin");
        sheet.style.transform = "";
        sheet.style.willChange = "";
        const dim = dims[index];
        if (dim) dim.style.opacity = "";
      });
    },
  };
}

/**
 * A stack of CSS-sticky items inside a section (builders, principles). As an
 * item slides over the one before, that one settles back; an item that has
 * reached its sticky position is marked `is-landed`.
 */
export function cardStackScene(
  list: HTMLElement,
  options: { recede: string; scale?: number; onActive?: (index: number) => void },
): Scene {
  const items = [...list.querySelectorAll<HTMLElement>(":scope > li")];
  const targets = items.map((item) => item.querySelector<HTMLElement>(options.recede) ?? item);
  const dims = items.map((item) => item.querySelector<HTMLElement>("[data-hb-dim]"));
  const sticks = items.map(() => 0);
  const tops = items.map(() => 0);
  const visible = items.map(() => true);
  let sticky = false;
  let active = -1;
  let vh = window.innerHeight;
  const depth = options.scale ?? 0.05;

  return {
    measure() {
      vh = window.innerHeight;
      sticky = items.length > 1 && getComputedStyle(items[0]).position === "sticky";
      items.forEach((item, index) => {
        visible[index] = item.offsetHeight > 0;
        sticks[index] = Number.parseFloat(getComputedStyle(item).top) || 0;
      });
    },
    read() {
      if (!sticky) return;
      items.forEach((item, index) => {
        if (visible[index]) tops[index] = item.getBoundingClientRect().top;
      });
    },
    write() {
      if (!sticky) return;
      let front = 0;
      items.forEach((item, index) => {
        if (!visible[index]) return;
        const isLanded = tops[index] <= sticks[index] + 6;
        // The item in front is the latest one to have risen past mid-screen.
        if (tops[index] < vh * 0.55) front = index;
        item.classList.toggle("is-landed", isLanded);
        let next = index + 1;
        while (next < items.length && !visible[next]) next += 1;
        const p = next < items.length ? clamp01((vh - tops[next]) / (vh - sticks[next])) : 0;
        targets[index].style.transform = p > 0 ? `scale(${(1 - depth * p).toFixed(4)})` : "";
        const dim = dims[index];
        if (dim) dim.style.opacity = (0.55 * p * p).toFixed(3);
      });
      if (front !== active) {
        active = front;
        options.onActive?.(active);
      }
    },
    destroy() {
      items.forEach((item, index) => {
        item.classList.remove("is-landed");
        targets[index].style.transform = "";
        const dim = dims[index];
        if (dim) dim.style.opacity = "";
      });
    },
  };
}
