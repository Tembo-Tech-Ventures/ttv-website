import { getShadow } from "@/modules/mui/theme/constants";
import { Box, BoxProps } from "@mui/material";

export function Card(props: BoxProps) {
  return (
    <Box
      sx={{
        borderRadius: 2,
        p: 4,
        bgcolor: "secondary.dark",
        borderColor: "secondary.main",
        borderWidth: 2,
        borderStyle: "solid",
        boxShadow: getShadow("md"),
        transition: "box-shadow 0.3s",
        "&:hover": {
          boxShadow: getShadow("lg"),
          transition: "box-shadow 0.3s",
        },
      }}
      {...props}
    />
  );
}
