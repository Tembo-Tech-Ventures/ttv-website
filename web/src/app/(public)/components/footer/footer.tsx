"use client";

import { Elephant } from "@/assets/brand/elephant";
import { Link } from "@/components/link/link";
import {
  Box,
  Container,
  Divider,
  Stack,
  Typography,
  useTheme,
} from "@mui/material";
import Grid from "@mui/material/Grid";

export function Footer() {
  const theme = useTheme();
  return (
    <Container component="footer" sx={{ py: 10 }}>
      <Stack direction="column" spacing={4}>
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, sm: 6 }}>
            <Stack direction="row" spacing={2}>
              <Box maxWidth={100}>
                <Elephant color={theme.palette.primary.main} />
              </Box>
              <Typography variant="h3" fontSize={35} color="primary">
                Tembo
                <br />
                Tech
                <br />
                Ventures
              </Typography>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <Stack direction="column" spacing={2}>
              <Typography variant="h4" color="grey.300">
                Links
              </Typography>
              <Typography variant="body2">
                <Link href="/auth/login">Login</Link>
              </Typography>
              <Typography variant="body2">
                <Link href="/auth/register">Register</Link>
              </Typography>
              <Typography variant="body2">
                <Link href="/dashboard/apply">Apply</Link>
              </Typography>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 3 }}>
            <Stack direction="column" spacing={2}>
              <Typography variant="h4" color="grey.300">
                Connect
              </Typography>
              <Typography variant="body2">
                <Link href="mailto:hello@tembotechventures.com">Email</Link>
              </Typography>
              <Typography variant="body2">
                <Link href="https://www.linkedin.com/company/tembo-tech-ventures/">
                  LinkedIn
                </Link>
              </Typography>
            </Stack>
          </Grid>
        </Grid>
        <Divider />
        <Stack direction="column" spacing={2}>
          <Typography variant="body2" align="center">
            © {new Date().getFullYear()} Tembo Tech Ventures
            <br />
            All rights reserved
          </Typography>
        </Stack>
      </Stack>
    </Container>
  );
}
