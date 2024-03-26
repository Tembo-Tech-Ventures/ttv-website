import { Link } from "@/components/link/link";
import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { Stack, Typography } from "@mui/material";

export default async function NotFound() {
  const session = await getServerSession();

  return (
    <Stack
      sx={{
        backgroundColor: "dark.main",
        backgroundImage: "linear-gradient(-15deg, #2C6964, #013D39)",
        minHeight: "100vh",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Typography variant="h1" color="primary">
        Nothing here.
      </Typography>
      <Typography variant="h4" color="white">
        Try heading back to the{" "}
        <Link href="/" muiLinkProps={{ sx: { color: "white" } }}>
          home page
        </Link>
        .
      </Typography>
    </Stack>
  );
}
