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

function Value({ title, description }: { title: string; description: string }) {
  return (
    <Box>
      <Typography variant="h3" color="primary">
        {title}
      </Typography>
      <Typography>{description}</Typography>
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
            <Value
              title="Empowerment"
              description="We believe in empowering young African developers to reach their full potential."
            />
            <Value
              title="Impact"
              description="We believe in the power of technology to create positive change and solve real-world problems."
            />
            <Value
              title="Equity"
              description="We aim to provide equal access to the training and opportunities needed to succeed in tech."
            />
            <Value
              title="Community"
              description="We foster a sense of community among our developers and mentors."
            />
            <Value
              title="Innovation"
              description="We strive to innovate and push the boundaries of what is possible."
            />
          </Stack>
        </Stack>
      </Card>
    </Container>
  );
}
