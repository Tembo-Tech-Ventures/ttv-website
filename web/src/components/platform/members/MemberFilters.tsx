import { PiMagnifyingGlass } from "react-icons/pi";
import { Button, SelectField, TextField, linkClass } from "@/components/platform/ui";
import { isFiltered, MEMBER_FILTER_LIMITS, MEMBER_RESULTS_ID, MEMBERS_PATH, OPEN_TO_LABELS, type MemberDirectoryFilters } from "./member-display";

interface MemberFiltersProps {
  filters: MemberDirectoryFilters;
}

const OPEN_TO_OPTIONS = [
  { value: "", label: "Anyone" },
  { value: "freelance", label: OPEN_TO_LABELS.freelance },
  { value: "roles", label: OPEN_TO_LABELS.roles },
];

/**
 * Finding people: a GET form, so the filters are the address, a search can be
 * linked to and it all works without JavaScript. It lands on the results
 * heading, so a keyboard carries on from the results. Searching starts again
 * from the first page: the form sends no cursor.
 */
export default function MemberFilters({ filters }: MemberFiltersProps) {
  return (
    <search aria-label="Find members">
      <form method="get" action={`${MEMBERS_PATH}#${MEMBER_RESULTS_ID}`} className="member-filters" data-member-filters>
        <TextField
          id="member-search" name="q" type="search" label="Search" defaultValue={filters.q} maxLength={MEMBER_FILTER_LIMITS.q}
          autoComplete="off" hint="Names, headlines, skills and what people are looking for"
        />
        <TextField
          id="member-skills" name="skills" label="Skills" defaultValue={filters.skills.join(", ")} autoComplete="off"
          hint={`Up to ${MEMBER_FILTER_LIMITS.skills}, separated by commas`}
        />
        <SelectField id="member-open" name="open" label="Open to" options={OPEN_TO_OPTIONS} defaultValue={filters.openTo ?? ""} />
        <div className="member-filters__actions">
          <Button type="submit" icon={<PiMagnifyingGlass />}>Show members</Button>
          {isFiltered(filters) && <a href={`${MEMBERS_PATH}#${MEMBER_RESULTS_ID}`} className={linkClass("inline-flex min-h-11 items-center")}>Clear filters</a>}
        </div>
      </form>
    </search>
  );
}
