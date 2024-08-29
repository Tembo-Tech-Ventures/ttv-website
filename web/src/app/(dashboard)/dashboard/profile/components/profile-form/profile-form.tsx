"use client";

import { client } from "@/modules/api/client";
import {
  Button,
  CircularProgress,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { User } from "@prisma/client";
import { atom, useAtom } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { CloudinaryContext, Image } from "cloudinary-react";
import { CldImage } from "next-cloudinary";
import { CldUploadWidget, CldUploadButton } from "next-cloudinary";
import useSWRMutation from "swr/mutation";

const profileFormAtom = atom<Partial<User>>({
  name: "",
});

export function ProfileForm({ user }: { user: User }) {
  const [form, setForm] = useAtom(profileFormAtom);
  const [uploadedImageUrl, setUploadedImageUrl] = useState("");

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
    submit,
  );
  const handleUpload = useCallback((result: any) => {
    console.log("Upload result:", result);
    const imageUrl = result.info.secure_url;
    setUploadedImageUrl(imageUrl);
  }, []);

  useEffect(() => {
    console.log(uploadedImageUrl);
  }, [uploadedImageUrl]);

  console.log("Does it even work");
  return (
    <>
      <CldUploadWidget
        options={{
          cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
          uploadPreset: process.env.NEXT_PUBLIC_CLOUDINARY_PRESET_NAME,
        }}
      />
      <CldUploadButton
        options={{ maxFiles: 1 }}
        onUploadAdded={handleUpload}
        uploadPreset={process.env.NEXT_PUBLIC_CLOUDINARY_PRESET_NAME}
      >
        Upload File
      </CldUploadButton>
      <Typography variant="h2">Upload files</Typography>
      {uploadedImageUrl && (
        <CldImage
          src={uploadedImageUrl}
          width={500} // Specify the desired width
          height={300} // Specify the desired height
          alt="Uploaded Image"
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
