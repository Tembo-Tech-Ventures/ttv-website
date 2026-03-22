"use client";

import {
  getFileUploadUrl,
  deleteFile,
  FileUploadResult,
} from "@/app/actions/file";
import { Button, styled, Typography } from "@mui/material";
import { ChangeEvent, useCallback, useState } from "react";
import { PiCloud, PiTrashDuotone } from "react-icons/pi";

const VisuallyHiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

export interface FileUploadProps {
  onChange?: (url?: string) => void;
}

export function FileUpload({ onChange }: FileUploadProps) {
  const [status, setStatus] = useState<
    "idle" | "uploading" | "success" | "error"
  >("idle");
  const [fileInfo, setFileInfo] = useState<FileUploadResult | null>(null);

  const onChangeInner = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setStatus("uploading");
      const mimeType = file.type;
      const filename = file.name;
      const size = file.size;
      try {
        const data = await getFileUploadUrl({ filename, mimeType, size });
        const url = data.url;
        await fetch(url, {
          method: "PUT",
          body: file,
        });
        const newUrl = new URL(url);
        newUrl.search = "";
        setFileInfo(data);
        onChange?.(newUrl.toString());
        setStatus("success");
      } catch (err) {
        console.error("Error", err);
        setStatus("error");
      }
    },
    [onChange],
  );

  const onDelete = useCallback(async () => {
    if (!fileInfo?.id) return;
    try {
      await deleteFile(fileInfo.id);
      setFileInfo(null);
      onChange?.(undefined);
      setStatus("idle");
    } catch (err) {
      console.error("Error", err);
      alert("There was an error deleting the file");
    }
  }, [fileInfo, onChange]);

  if (fileInfo?.filename) {
    return (
      <Button
        startIcon={<PiTrashDuotone fontSize={25} />}
        variant="contained"
        color="secondary"
        onClick={onDelete}
      >
        ...{fileInfo.filename.slice(-8)}
      </Button>
    );
  }

  return (
    <>
      <Button
        component="label"
        role={undefined}
        variant="contained"
        tabIndex={-1}
        startIcon={<PiCloud fontSize={25} />}
        disabled={status === "uploading"}
      >
        Upload file
        <VisuallyHiddenInput type="file" onChange={onChangeInner} />
      </Button>
      {status !== "idle" && (
        <Typography component="p" variant="caption" color="textSecondary">
          {status === "uploading" && "Uploading file..."}
          {status === "success" && "File uploaded successfully"}
          {status === "error" && "There was an error uploading the file"}
        </Typography>
      )}
    </>
  );
}
