"use client";

import { updateUserProfile } from "@/app/actions/user";
import { Button, CircularProgress, Stack, TextField } from "@mui/material";
import type { User } from "@/generated/prisma/browser";
import { atom, useAtom } from "jotai";
import { useCallback, useEffect } from "react";
import useSWRMutation from "swr/mutation";

const profileFormAtom = atom<Partial<User>>({
  name: "",
});

export function ProfileForm({ user }: { user: User }) {
  const [form, setForm] = useAtom(profileFormAtom);

  useEffect(() => {
    setForm(user);
  }, [setForm, user]);

  const submit = useCallback(async () => {
    await updateUserProfile(form);
  }, [form]);

  const { trigger, isMutating } = useSWRMutation("updateUserProfile", submit);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        trigger();
      }}
    >
      <Stack spacing={2}>
        <TextField value={user.email} label="Email" disabled />
        <TextField
          value={form.name || ""}
          label="Name"
          onChange={(e) =>
            setForm((prev) => ({
              ...prev,
              name: e.target.value,
            }))
          }
          disabled={isMutating}
        />
        <div>
          <Button type="submit" variant="contained" disabled={isMutating}>
            {isMutating ? <CircularProgress size={24} /> : "Save"}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
