"use client";

import { Save } from "@mui/icons-material";
import { Box, IconButton, TextField } from "@mui/material";
import { useState } from "react";
import { UserPageData } from "../../lib/get-user-page-data/get-user-page-data";
import { adminUpdateUser } from "@/app/actions/user";
import { useRouter } from "next/navigation";

interface NameProps {
  userPageData: UserPageData;
}

export function Name({ userPageData }: NameProps) {
  const [name, setName] = useState(userPageData?.user?.name);
  const router = useRouter();

  return (
    <Box>
      <TextField
        label="Name"
        value={name || ""}
        onChange={(e) => setName(e.target.value)}
        InputProps={{
          endAdornment: (
            <IconButton
              onClick={async () => {
                await adminUpdateUser(userPageData?.user?.id!, name ?? null);
                router.refresh();
              }}
            >
              <Save />
            </IconButton>
          ),
        }}
      />
    </Box>
  );
}
