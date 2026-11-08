import { useEffect, useId, useRef, useState } from "react";
import Button from "@/components/platform/ui/Button";
import { TextAreaField } from "@/components/platform/ui/Field";
import Notice from "@/components/platform/ui/Notice";
import { useEnterSends } from "./useEnterSends";

/**
 * The author's words, back in a box: Save or Cancel, Enter saves with a keyboard, Escape cancels.
 * Save is quiet: the view's one peach action stays the composer's Send.
 */
export function EditForm({ initial, onSave, onCancel }: { initial: string; onSave: (body: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const enterSends = useEnterSends();
  const form = useRef<HTMLFormElement>(null);
  const id = useId();

  useEffect(() => {
    const textarea = form.current?.querySelector("textarea");
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
      ref={form}
      className="channel-edit mt-1.5 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <TextAreaField
        id={id}
        label="Edit your message"
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
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="quiet" size="sm" loading={saving} disabled={unchanged}>
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

/**
 * "Delete this message?" in place, as a warning before something final, with the safe choice focused,
 * so a stray Enter keeps it. The question names the group its buttons answer.
 */
export function DeleteConfirm({ onDelete, onKeep }: { onDelete: () => Promise<void>; onKeep: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const group = useRef<HTMLFieldSetElement>(null);
  const id = useId();

  useEffect(() => group.current?.querySelector<HTMLButtonElement>("[data-keep]")?.focus(), []);

  return (
    <fieldset ref={group} aria-labelledby={`${id}-title`} aria-describedby={`${id}-detail`} className="m-0 mt-2 max-w-152 min-w-0 border-0 p-0" data-delete-confirm>
      <Notice
        tone="warning"
        title={<span id={`${id}-title`}>Delete this message?</span>}
        actions={
          <>
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
              Delete message
            </Button>
            <Button data-keep size="sm" variant="ghost" onClick={onKeep}>
              Keep it
            </Button>
          </>
        }
      >
        <span id={`${id}-detail`}>People will see that a message was deleted.</span>
      </Notice>
    </fieldset>
  );
}
