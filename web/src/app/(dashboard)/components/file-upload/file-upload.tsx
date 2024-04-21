"use client";

import { Button, styled } from "@mui/material";
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
  const [url, setUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const onChangeInner = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setStatus("uploading");
      const mimeType = file.type;
      const filename = file.name;
      const basePath = "applications";
      try {
        const response = await fetch("/api/file/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, basePath, mimeType }),
        });
        const data = await response.json();
        const url = data.url;
        await fetch(url, {
          method: "PUT",
          body: file,
        });
        const newUrl = new URL(url);
        newUrl.search = "";
        setFilename(filename);
        setUrl(newUrl.toString());
        onChange?.(newUrl.toString());
        setStatus("success");
      } catch (err) {
        console.error("Error", err);
        setStatus("error");
      }
    },
    [onChange],
  );

  if (url) {
    return (
      <Button
        startIcon={<PiTrashDuotone fontSize={25} />}
        variant="contained"
        color="secondary"
      >
        Delete {filename}
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
      {status === "uploading" && <div>Uploading file...</div>}
      {status === "success" && <div>File uploaded successfully</div>}
      {status === "error" && <div>There was an error uploading the file</div>}
    </>
  );
}
