import type { SpaceId } from "@/lib/platform/contracts";
import { CountBadge, SpaceGlyph } from "@/components/platform/ui";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import type { SpaceLink } from "./SpacesShell";

type Person = { id: string; name: string; src?: string };

/**
 * On phones the spaces leave the top of the screen for the thumb: one bar of
 * spaces only, in the same order as the tabs and with Profile last. Search and
 * attention stay at the top, and the current space's sidebar becomes a drawer.
 */
export default function SpaceBottomBar({
  links,
  active,
  person,
}: {
  links: readonly SpaceLink[];
  active: SpaceId;
  person: Person;
}) {
  return (
    <nav aria-label="Spaces" className="spaces-bottom" data-count={links.length}>
      <ul className="spaces-bottom__list">
        {links.map((link) => {
          const current = link.space === active;
          return (
            <li key={link.space} className="spaces-bottom__item" data-space={link.space}>
              <a
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={cx("spaces-bottom__link", FOCUS_RING)}
              >
                <span aria-hidden="true" className="spaces-bottom__glyph">
                  <SpaceGlyph space={link.space} person={person} />
                  {link.count > 0 && (
                    <span className="spaces-bottom__badge">
                      <CountBadge count={link.count} label="new" />
                    </span>
                  )}
                </span>
                <span className="spaces-bottom__label">{link.label}</span>
                {link.count > 0 && <span className="sr-only">{`, ${link.count} new`}</span>}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
