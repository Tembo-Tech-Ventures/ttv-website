/*
 * The table roles below are written out on purpose: below 40rem the table's
 * parts are display: block, and some browsers then stop exposing them as a
 * table. Restating the roles keeps the headers announced with each cell.
 */
/* oxlint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role */
import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";
import { CHOICE_BOX, buttonClass } from "./recipes";
// oxlint-disable-next-line import/no-unassigned-import -- how a table stacks on a phone.
import "./data-table.css";

/*
 * A table of many things side by side: people, applications, recordings. It
 * is composed rather than fed data, `<DataTable>` holding `<DataRow>`s of
 * `<DataCell>`s, so an `.astro` page can put a link, a chip or an action in any
 * cell. Below 40rem each row stacks into a block that names each fact, so
 * nothing scrolls sideways at 320px; the table roles are spelled out so that a
 * screen reader still hears a table once the layout changes.
 */

export type DataColumn = {
  /** The column's name, in sentence case: "Joined", not "JOINED". */
  label: string;
  /** Numbers and dates read best against the end. */
  align?: "start" | "end";
  /** Named for screen readers only: an actions column, a selection column. */
  hidden?: boolean;
};

type DataTableProps = {
  /** What the table lists, read before it: "Users". Shown when `captionVisible`. */
  caption: string;
  captionVisible?: boolean;
  columns: readonly DataColumn[];
  /** `DataRow`s. */
  children?: ReactNode;
  /** True when there are no rows: the table gives way to `empty`. */
  isEmpty?: boolean;
  /** An `EmptyState` for a list with nothing in it yet. From `.astro`, `<Fragment slot="empty">`. */
  empty?: ReactNode;
  className?: string;
};

const ALIGN = { start: "text-left", end: "text-right" } as const;

export default function DataTable({ caption, captionVisible = false, columns, children, isEmpty = false, empty, className }: DataTableProps) {
  if (isEmpty) return <>{empty}</>;
  return (
    <div data-data-table className={cx("min-w-0", className)}>
      <table role="table" className="kit-table w-full border-collapse text-sm">
        <caption className={captionVisible ? "mb-3 text-left text-sm font-semibold text-ink-primary" : "sr-only"}>{caption}</caption>
        <thead role="rowgroup">
          <tr role="row">
            {columns.map((column) => (
              <th
                key={column.label}
                role="columnheader"
                scope="col"
                className={cx(
                  "border-b border-hairline px-3 py-2.5 text-[0.8125rem] font-semibold text-ink-secondary first:pl-0 last:pr-0",
                  ALIGN[column.align ?? "start"],
                )}
              >
                {column.hidden ? <span className="sr-only">{column.label}</span> : column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">{children}</tbody>
      </table>
    </div>
  );
}

type DataRowProps = Omit<HTMLAttributes<HTMLTableRowElement>, "className" | "children"> & {
  children: ReactNode;
  /** A row that is picked, open or new: lifted a little, never coloured alone. */
  current?: boolean;
  className?: string;
};

/** One thing in the table. Its first cell names it. */
export function DataRow({ children, current, className, ...rest }: DataRowProps) {
  return (
    <tr {...rest} role="row" data-current={current || undefined} className={cx("kit-table__row transition-colors duration-150 motion-reduce:transition-none hover:bg-ink-primary/4 data-current:bg-ink-primary/4", className)}>
      {children}
    </tr>
  );
}

type DataCellProps = {
  /** The column's name, said beside the value when the row stacks on a phone. */
  label: string;
  children?: ReactNode;
  /**
   * The cell that names the row: first, and bold once the row stacks. A link in it is a 44px target
   * on a touch screen without moving the row (data-table.css).
   */
  primary?: boolean;
  align?: "start" | "end";
  className?: string;
};

/** One fact in a row. */
export function DataCell({ label, children, primary = false, align = "start", className }: DataCellProps) {
  return (
    <td
      role="cell"
      data-label={label}
      data-primary={primary || undefined}
      className={cx(
        "kit-table__cell border-b border-hairline px-3 py-3 align-middle break-words text-ink-primary first:pl-0 last:pr-0",
        primary && "font-semibold",
        ALIGN[align],
        className,
      )}
    >
      {children}
    </td>
  );
}

type DataSelectCellProps = {
  /** The form field's name, shared by every row: "applicationIds". */
  name: string;
  value: string;
  /** Names the row, so the box is read as "Select Wanjiku Mwangi". */
  row: string;
  /** The id of the form the selection submits with, when the table is outside it. */
  form?: string;
  defaultChecked?: boolean;
};

/** A row's selection box, for an action on several rows at once. Its column is `{ label: "Select", hidden: true }`. */
export function DataSelectCell({ name, value, row, form, defaultChecked }: DataSelectCellProps) {
  return (
    <td role="cell" data-label="" data-select className="kit-table__cell w-0 border-b border-hairline py-3 pr-3 align-middle">
      <input type="checkbox" name={name} value={value} form={form} defaultChecked={defaultChecked} aria-label={`Select ${row}`} className={CHOICE_BOX} />
    </td>
  );
}

type RowActionProps = {
  href: string;
  /** What it does, in a word or two, shown: "Edit". */
  children: string;
  /** The row it acts on, added for screen readers: "Edit Wanjiku Mwangi". */
  row: string;
  variant?: "quiet" | "ghost";
};

/**
 * An action on one row, quiet so a list of them never outshouts the page's
 * one primary. Its name says which row, because "Edit, Edit, Edit" tells a
 * screen reader nothing.
 */
export function RowAction({ href, children, row, variant = "quiet" }: RowActionProps) {
  return (
    <a href={href} data-row-action className={buttonClass({ variant, size: "sm" })}>
      {children}
      <span className="sr-only">{` ${row}`}</span>
    </a>
  );
}
