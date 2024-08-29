"use client";

import { client } from "@/modules/api/client";
import {
  Button,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { User } from "@prisma/client";
import { atom, useAtom } from "jotai";
import { CldImage, CldUploadButton } from "next-cloudinary";
import { ComponentProps, useCallback, useEffect, useState } from "react";
import useSWRMutation from "swr/mutation";

const profileFormAtom = atom<Partial<User>>({
  name: "",
  image: null,
});

export function ProfileForm({ user }: { user: User }) {
  const [form, setForm] = useAtom(profileFormAtom);

  useEffect(() => {
    setForm(user);
  }, [setForm, user]);

  const submit = useCallback(async () => {
    await client.api.v1.user.$put({
      json: form,
    });
  }, [form]);

  const { trigger, isMutating } = useSWRMutation(
    "client.api.v1.user.$put",
    submit
  );

  return (
    <>
      <CldUploadButton
        options={{
          maxFiles: 1,
          cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
        }}
        onSuccessAction={(results) => {
          setForm((prev) => ({
            ...prev,
            image: (results.info as any).public_id,
          }));
        }}
        uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_PRESET_NAME}
      >
        Upload File
      </CldUploadButton>
      <Typography variant="h2">Upload files</Typography>
      {form.image && (
        <CldImage
          src={form.image}
          width={200}
          height={200}
          alt="Uploaded Image"
          style={{ objectFit: "cover" }}
        />
      )}
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
    </>
  );
}
