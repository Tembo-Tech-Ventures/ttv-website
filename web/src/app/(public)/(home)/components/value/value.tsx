import { getShadow } from "@/modules/mui/theme/constants";
import { useGSAP } from "@gsap/react";
import { Box, Container, Typography, useTheme } from "@mui/material";
import gsap from "gsap";

export function Value() {
  const theme = useTheme();
  useGSAP(() => {
    const scrollTrigger = {
      trigger: "#home-value-description",
      start: "top 80%",
      end: "bottom top",
      scrub: true,
    };
    const timeline = gsap.timeline({
      scrollTrigger,
    });
    timeline
      .fromTo(
        "#home-value-description",
        { opacity: 0 },
        {
          opacity: 1,
        },
      )
      .to("#home-value-description", {
        opacity: 1,
        duration: 0.05,
      })
      .to("#home-value-description", {
        opacity: 0,
      });
    gsap.fromTo(
      "#home-value-gradient",
      {
        left: "-100%",
      },
      {
        left: "100%",
        ease: "power2.inOut",
        scrollTrigger: {
          trigger: "#home-value-gradient",
          start: "bottom bottom",
          end: "top top",
          scrub: true,
        },
      },
    );
  });
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Box
        sx={{
          p: "2px",
          position: "relative",
          borderRadius: 2,
          overflow: "hidden",
          boxShadow: getShadow("lg"),
        }}
      >
        <Box
          sx={{
            position: "absolute",
            zIndex: 1,
            top: 0,
            left: 0,
            backgroundImage: `linear-gradient(45deg, transparent, ${theme.palette.secondary.light}, transparent)`,
            height: "100%",
            width: "100%",
          }}
          id="home-value-gradient"
        />
        <Box
          sx={{
            backgroundColor: "dark.main",
            borderRadius: 2,
            px: 4,
            py: 2,
            position: "relative",
            zIndex: 10,
          }}
        >
          <Typography
            variant="h4"
            color="grey.300"
            align="center"
            id="home-value-description"
          >
            Tembo Tech Ventures is training a new generation of software
            developers and technologists in Africa.
          </Typography>
        </Box>
      </Box>
    </Container>
  );
}
