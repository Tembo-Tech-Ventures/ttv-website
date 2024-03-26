import { Card } from "@/components/card/card";
import { getShadow } from "@/modules/mui/theme/constants";
import { Box, Container, Stack, Typography } from "@mui/material";
import { PiHeartDuotone } from "react-icons/pi";
import { keyframes } from "@emotion/react";

const rotateAnimation = keyframes`
  0% {
    transform: rotate(0deg);
  }
  50% {
    transform: rotate(40deg);
  }
  100% {
    transform: rotate(0deg);
  }
`;

function HeartAnimation() {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: "center",
        backgroundColor: "primary.main",
        height: 100,
        width: 100,
        borderRadius: "50%",
        color: "white",
        alignItems: "center",
        position: "absolute",
        top: {
          xs: -50,
          sm: -50,
        },
        right: {
          xs: 0,
          sm: -50,
        },
        border: "2px solid",
        borderColor: "primary.dark",
        boxShadow: getShadow("md"),
        animation: `${rotateAnimation} 2s infinite ease-in-out`,
      }}
    >
      <PiHeartDuotone size={50} />
    </Box>
  );
}

export function OurValues() {
  return (
    <Container>
      <Card position="relative">
        <HeartAnimation />
        <Stack direction="column" rowGap={4}>
          <Typography variant="h2" color="grey.300" align="center">
            Our Values
          </Typography>
          <Stack direction="column" rowGap={4}>
            <Box>
              <Typography variant="h3" color="primary">
                Empowerment
              </Typography>
              <Typography>
                We believe in empowering young African developers to reach their
                full potential.
              </Typography>
            </Box>
            <Box>
              <Typography variant="h3" color="primary">
                Equity
              </Typography>
              <Typography>
                Our mission is to provide equal access to the training and
                opportunities needed to succeed in tech.
              </Typography>
            </Box>
            <Box>
              <Typography variant="h3" color="primary">
                Community
              </Typography>
              <Typography>
                We foster a sense of community among our developers and mentors.
              </Typography>
            </Box>
            <Box>
              <Typography variant="h3" color="primary">
                Innovation
              </Typography>
              <Typography>
                We strive to innovate and push the boundaries of what is
                possible.
              </Typography>
            </Box>
          </Stack>
        </Stack>
      </Card>
    </Container>
  );
}
