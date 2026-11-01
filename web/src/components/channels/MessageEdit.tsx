import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/platform/ui/Button";
import { useEnterSends } from "./useEnterSends";

/** The author's words, back in a box: Save or Cancel, Enter saves with a keyboard, Escape cancels. */
export function EditForm({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const enterSends = useEnterSends();
  const box = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  useEffect(() => {
    const textarea = box.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  const unchanged = value.trim() === "" || value.trim() === initial.trim();
  async function save() {
    if (unchanged || saving) return;
    setSaving(true);
    try {
      await onSave(value.trim());
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="mt-1.5 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Edit your message
      </label>
      <textarea
        id={id}
        ref={box}
        value={value}
        rows={3}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          } else if (event.key === "Enter" && enterSends && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
        className="channel-input min-h-20 w-full resize-y rounded-xl px-3 py-2"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={unchanged}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {enterSends && <span className="text-xs text-ink-muted">Enter saves, Escape cancels</span>}
      </div>
    </form>
  );
}

/** "Delete this message?" in place, with the safe choice focused, so a stray Enter keeps it. */
export function DeleteConfirm({ onDelete, onKeep }: { onDelete: () => Promise<void>; onKeep: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const group = useRef<HTMLFieldSetElement>(null);

  useEffect(() => group.current?.querySelector<HTMLButtonElement>("[data-keep]")?.focus(), []);

  return (
    <fieldset ref={group} className="channel-confirm">
      <legend className="float-left text-sm text-ink-primary">Delete this message? People will see that a message was deleted.</legend>
      <div className="flex items-center gap-2">
        <Button
          variant="danger"
          size="sm"
          loading={deleting}
          onClick={async () => {
            setDeleting(true);
            try {
              await onDelete();
            } finally {
              setDeleting(false);
            }
          }}
        >
          Delete
        </Button>
        <Button data-keep size="sm" variant="ghost" onClick={onKeep}>
          Keep it
        </Button>
      </div>
    </fieldset>
  );
}
