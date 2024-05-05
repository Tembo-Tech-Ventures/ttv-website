import { getServerSession } from "@/modules/auth/lib/get-server-session/get-server-session";
import { Box, Stack, TextField, Typography } from "@mui/material";
import { ProfileForm } from "./components/profile-form/profile-form";
import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export default async function Profile() {
  const session = await getServerSession();
  const user = await prisma.user.findUnique({
    where: { id: session?.user?.id },
  });

  if (!user) {
    return <div>Unauthorized</div>;
  }

  console.log("@@ user: ", user);

  return (
    <Box maxWidth="sm">
      <Stack spacing={2}>
        <Typography variant="h4" color="white">
          Profile
        </Typography>
        <ProfileForm user={user} />
      </Stack>
    </Box>
  );
}
