"use client";

import { Container, Typography } from "@mui/material";
import { FileUpload } from "../../components/file-upload/file-upload";

export default function ApplyPage() {
  return (
    <Container>
      <Typography variant="h4" color="white">
        Apply
      </Typography>
      <FileUpload onChange={(url) => console.log("@@ url: ", url)} />
    </Container>
  );
}
