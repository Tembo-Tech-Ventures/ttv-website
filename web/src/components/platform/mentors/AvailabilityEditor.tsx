import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { PiPlus, PiX } from "react-icons/pi";
import { MAX_MONTHLY_CAPACITY, MentorRequestFormat, type MentorAvailability } from "@/lib/platform/contracts";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import { useAvailability } from "@/lib/platform/client/hooks/mentoring";
import {
  createAvailabilityStore, isDirty, MAX_AREA, MAX_BIO, MAX_HEADLINE, type AvailabilityField,
} from "@/lib/platform/client/mentor-availability";
import { Button, Card } from "@/components/platform/ui";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { capacityView, FORMAT_HINTS, FORMAT_LABELS, listingNote, MENTORS_PATH } from "./mentor-display";
// oxlint-disable-next-line import/no-unassigned-import -- Mentor connections stylesheet.
import "./mentors.css";

export interface AvailabilityEditorProps {
  initial: MentorAvailability;
  now: number;
  /** A fixture client for the DEV harness. Live pages call the API. */
  api?: ApiClient;
}

const FIELD = cx(
  "w-full rounded-xl border border-hairline bg-ink-primary/4 px-3.5 py-2.5 text-[0.9375rem] leading-relaxed text-ink-primary",
  "placeholder:text-ink-muted aria-invalid:border-danger-ink", FOCUS_RING,
);
const LABEL = "text-[0.9375rem] font-semibold text-ink-primary";
const HINT = "mt-1.5 text-[0.8125rem] text-ink-muted";
const ERROR = "mt-1 text-sm font-semibold text-danger-ink";
/** The order the form reads in, so the first problem is the one focused. */
const ORDER: readonly AvailabilityField[] = ["headline", "areas", "formats", "monthlyCapacity", "bio"];

/**
 * Mentoring → Availability (screen 06's rail, in full): what members read
 * about this mentor and how much time they give. Edits stay here until
 * saved; the listing note above always says what the server has.
 */
export default function AvailabilityEditor({ initial, now, api }: AvailabilityEditorProps) {
  const [store] = useState(() => createAvailabilityStore({ initial, ...(api ? { api } : {}) }));
  const state = useAvailability(store);
  const { draft, saved, errors } = state;
  const ids = useId();
  const fields = useRef<Partial<Record<AvailabilityField, HTMLElement | null>>>({});
  const saving = state.status === "saving";
  const dirty = isDirty(state);
  const describe = (field: AvailabilityField, hint = true) =>
    [hint ? `${ids}-${field}-hint` : "", errors[field] ? `${ids}-${field}-error` : ""].filter(Boolean).join(" ") || undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const result = await store.save();
    if (result) return;
    const first = ORDER.find(field => store.getState().errors[field]);
    if (first) fields.current[first]?.focus();
  }

  function onAreaKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    store.addArea();
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-3xl flex-col gap-8" aria-busy={saving || undefined} data-availability-editor>
      <output className="sr-only" aria-live="polite">{state.announcement}</output>

      <Card className="flex flex-col gap-2" data-listing={saved.listed ? "listed" : "unlisted"}>
        <p className="text-[0.9375rem] font-semibold text-ink-primary">{saved.listed ? "Listed in the mentor directory" : "Not in the mentor directory"}</p>
        <p className="text-sm leading-relaxed text-ink-secondary">{listingNote(saved)}</p>
        {saved.listed && (
          <p className="text-sm text-ink-secondary">
            This month: {capacityView(saved.capacity, now).text}.{" "}
            <a href={MENTORS_PATH} className={cx("font-semibold text-peach-ink underline underline-offset-4", FOCUS_RING)}>See the directory</a>
          </p>
        )}
      </Card>

      <div>
        <label htmlFor={`${ids}-headline`} className={LABEL}>Headline</label>
        <input
          ref={node => { fields.current.headline = node; }}
          id={`${ids}-headline`} value={draft.headline} maxLength={MAX_HEADLINE * 2} readOnly={saving}
          onChange={event => store.setHeadline(event.target.value)}
          aria-invalid={errors.headline ? true : undefined} aria-describedby={describe("headline")}
          className={cx(FIELD, "mt-2")} placeholder="Backend engineer · fintech"
        />
        <p id={`${ids}-headline-hint`} className={HINT}>What you do, in a line. Members see it under your name.</p>
        {errors.headline && <p id={`${ids}-headline-error`} className={ERROR}>{errors.headline}</p>}
      </div>

      <fieldset>
        <legend className={LABEL}>Areas you help with</legend>
        {draft.areas.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Your areas">
            {draft.areas.map(area => (
              <li key={area} className="inline-flex h-10 items-center gap-1 rounded-full bg-ring/8 pr-1 pl-3.5 text-sm font-semibold text-ring">
                {area}
                <button
                  type="button" onClick={() => store.removeArea(area)} disabled={saving}
                  aria-label={`Remove ${area}`}
                  className={cx("grid size-8 place-items-center rounded-full hover:bg-ring/15 pointer-coarse:size-10", FOCUS_RING)}
                >
                  <PiX aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-secondary">No areas yet. Members filter the directory by area.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <label htmlFor={`${ids}-area`} className="sr-only">Add an area</label>
          <input
            ref={node => { fields.current.areas = node; }}
            id={`${ids}-area`} value={state.areaInput} maxLength={MAX_AREA * 2} readOnly={saving}
            onChange={event => store.setAreaInput(event.target.value)} onKeyDown={onAreaKey}
            aria-invalid={errors.areas ? true : undefined} aria-describedby={describe("areas")}
            className={cx(FIELD, "max-w-xs flex-1")} placeholder="Add an area, such as Testing"
          />
          <Button icon={<PiPlus />} onClick={() => store.addArea()} disabled={saving}>Add area</Button>
        </div>
        <p id={`${ids}-areas-hint`} className={HINT}>Up to 20, each up to {MAX_AREA} characters. Press Enter to add.</p>
        {errors.areas && <p id={`${ids}-areas-error`} className={ERROR}>{errors.areas}</p>}
      </fieldset>

      <fieldset aria-describedby={describe("formats", false)}>
        <legend className={LABEL}>How you help</legend>
        <div className="mt-3 flex flex-col gap-2">
          {MentorRequestFormat.options.map((format, index) => (
            <label key={format} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-hairline px-3.5 py-2.5 has-checked:border-peach-ink has-checked:bg-primary/10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-peach-ink">
              <input
                ref={index === 0 ? node => { fields.current.formats = node; } : undefined}
                type="checkbox" checked={draft.formats.includes(format)} disabled={saving}
                onChange={() => store.toggleFormat(format)} className="mt-1 size-4 accent-peach-ink"
                aria-labelledby={`${ids}-${format}`} aria-describedby={`${ids}-${format}-hint`}
              />
              <span>
                <span id={`${ids}-${format}`} className="block text-sm font-semibold text-ink-primary">{FORMAT_LABELS[format]}</span>
                <span id={`${ids}-${format}-hint`} className="block text-[0.8125rem] text-ink-secondary">{FORMAT_HINTS[format]}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.formats && <p id={`${ids}-formats-error`} className={ERROR}>{errors.formats}</p>}
      </fieldset>

      <div>
        <label htmlFor={`${ids}-capacity`} className={LABEL}>Requests a month</label>
        <input
          ref={node => { fields.current.monthlyCapacity = node; }}
          id={`${ids}-capacity`} type="number" inputMode="numeric" min={0} max={MAX_MONTHLY_CAPACITY} step={1}
          value={draft.monthlyCapacity} readOnly={saving}
          onChange={event => store.setMonthlyCapacity(event.target.valueAsNumber)}
          aria-invalid={errors.monthlyCapacity ? true : undefined} aria-describedby={describe("monthlyCapacity")}
          className={cx(FIELD, "mt-2 w-28")}
        />
        <p id={`${ids}-monthlyCapacity-hint`} className={HINT}>
          From 0 to {MAX_MONTHLY_CAPACITY}. Each waiting request and each one you accept this month takes a spot; the count starts again on the 1st.
        </p>
        {errors.monthlyCapacity && <p id={`${ids}-monthlyCapacity-error`} className={ERROR}>{errors.monthlyCapacity}</p>}
      </div>

      <div>
        <label htmlFor={`${ids}-bio`} className={LABEL}>About you <span className="font-normal text-ink-secondary">(optional)</span></label>
        <textarea
          ref={node => { fields.current.bio = node; }}
          id={`${ids}-bio`} rows={4} value={draft.bio} maxLength={MAX_BIO * 2} readOnly={saving}
          onChange={event => store.setBio(event.target.value)}
          aria-invalid={errors.bio ? true : undefined} aria-describedby={describe("bio")}
          className={cx(FIELD, "mt-2 resize-y")}
        />
        <p id={`${ids}-bio-hint`} className={HINT}>A sentence or two on what you like reviewing. {draft.bio.trim().length} of {MAX_BIO} characters.</p>
        {errors.bio && <p id={`${ids}-bio-error`} className={ERROR}>{errors.bio}</p>}
      </div>

      <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-hairline px-4 py-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-peach-ink">
        <input
          type="checkbox" role="switch" aria-checked={draft.paused} checked={draft.paused} disabled={saving}
          onChange={event => store.setPaused(event.target.checked)} className="mt-1 size-4 accent-peach-ink"
          aria-labelledby={`${ids}-pause`} aria-describedby={`${ids}-pause-hint`}
        />
        <span>
          <span id={`${ids}-pause`} className="block text-[0.9375rem] font-semibold text-ink-primary">Pause new requests</span>
          <span id={`${ids}-pause-hint`} className="block text-sm text-ink-secondary">
            While paused you're not in the directory and nobody can send you a new request. Requests already waiting stay with you.
          </span>
        </span>
      </label>

      {state.status === "error" && (
        <p className="text-sm font-semibold text-danger-ink" data-availability-error>Couldn't save. Your changes are still here; try again.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={saving} disabled={!dirty && !saving}>Save availability</Button>
        <Button onClick={() => store.reset()} disabled={!dirty || saving}>Undo changes</Button>
        {state.status === "saved" && !dirty && <p className="text-sm text-ink-secondary" data-availability-saved>Saved.</p>}
      </div>
    </form>
  );
}
