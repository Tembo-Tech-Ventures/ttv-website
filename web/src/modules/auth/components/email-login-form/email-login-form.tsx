"use client";

import { Card } from "@/components/card/card";
import { Box, Button, Stack, TextField, Typography } from "@mui/material";
import { signIn } from "next-auth/react";
import { useState } from "react";

export function EmailLoginForm() {
  const [submitted, setSubmitted] = useState(false);

  if (!submitted) {
    return (
      <Box
        sx={{
          backgroundColor: "secondary.main",
          borderRadius: 2,
          py: 2,
          px: 3,
        }}
      >
        <Typography variant="body2">
          {`Check your email for a link to sign in. If it doesn't appear within a few minutes, check your spam folder.`}
        </Typography>
      </Box>
    );
  }

  return (
    <form
      action="#"
      onSubmit={(e) => {
        e.preventDefault();
        signIn("email", { email: (e.target as any).email.value });
        setSubmitted(true);
      }}
    >
      <Stack direction="row" spacing={2}>
        <TextField
          label="Email address"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
        <Button type="submit" variant="contained">
          <span>
            Submit <span aria-hidden="true">&rarr;</span>
          </span>
        </Button>
      </Stack>
    </form>
  );
}
