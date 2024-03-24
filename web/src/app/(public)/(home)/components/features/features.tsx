import { Card } from "@/components/card/card";
import { Container, Grid, Typography, TypographyProps } from "@mui/material";

function Title(props: TypographyProps) {
  return (
    <Typography variant="h3" color="primary" sx={{ fontSize: 30 }} {...props} />
  );
}

export function Features() {
  return (
    <Container sx={{ py: 8 }}> 
      <Grid container spacing={4} sx={{ width: "100%" }}>
        <Grid item xs={12} md={4}>
          <Card>
            <Title>Training</Title>
            <Typography>
              We find ambitious young developers and teach them the necessary
              skills to build web and mobile applications.
            </Typography>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <Title>Mentorship</Title>
            <Typography>
              We provide mentorship to developers who are looking to improve
              their skills and build their careers.
            </Typography>
          </Card>
        </Grid>
        <Grid item xs={12} md={4}>
          <Card>
            <Title>Startups</Title>
            <Typography>
              We tailor our training to the needs of startups and help our devs
              build products that solve real problems.
            </Typography>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
}
