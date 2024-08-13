import { Card } from "@/components/card/card";
import {
  Container,
  Grid,
  Stack,
  Typography,
  TypographyProps,
} from "@mui/material";

function Title(props: TypographyProps) {
  return (
    <Typography variant="h3" color="primary" sx={{ fontSize: 30 }} {...props} />
  );
}

export function Features() {
  return (
    <Container sx={{ py: 8 }}>
      <Stack direction="column" rowGap={4}>
        <Typography variant="h2" color="primary">
          What We Do
        </Typography>
        <Stack
          sx={{
            flexDirection: { xs: "column", md: "row" },
            gap: 4,
          }}
        >
          <Card>
            <Title>Training</Title>
            <Typography>
              We work with ambitious young developers and teach them the
              necessary skills to build web and mobile applications.
            </Typography>
          </Card>
          <Card>
            <Title>Mentorship</Title>
            <Typography>
              We provide mentorship to new developers who are looking to improve
              their skills and build their careers.
            </Typography>
          </Card>
          <Card>
            <Title>Impact</Title>
            <Typography>
              We encourage our community to take their skills and use them to
              solve real-world problems with startups and industry.
            </Typography>
          </Card>
        </Stack>
      </Stack>
    </Container>
  );
}
