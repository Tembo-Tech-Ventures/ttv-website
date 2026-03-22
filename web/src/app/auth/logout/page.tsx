"use client";

import { Container, Stack, Typography } from "@mui/material";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Logout() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      await signOut({
        callbackUrl: "/",
      });
    })();
  }, [router]);

  return (
    <Container maxWidth="md">
      <Stack
        sx={{ minHeight: "100vh", py: 4 }}
        direction="column"
        justifyContent="center"
      >
        <Typography variant="h1" color="primary">
          Logging you out...
        </Typography>
      </Stack>
    </Container>
  );
}
