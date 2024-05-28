"use client";

import { Link } from "@/components/link/link";
import { useLoginRedirect } from "@/modules/auth/hooks/use-login-redirect/use-login-redirect";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import MenuIcon from "@mui/icons-material/Menu";
import { Stack } from "@mui/material";
import MuiAppBar, { AppBarProps as MuiAppBarProps } from "@mui/material/AppBar";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import { styled, useTheme } from "@mui/material/styles";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import { useSession } from "next-auth/react";
import * as React from "react";
import {
  PiGaugeDuotone,
  PiImageSquareDuotone,
  PiSignOutDuotone,
  PiTable,
  PiTreeStructureDuotone,
  PiUserDuotone,
} from "react-icons/pi";
interface NavLinkProps {
  icon: React.ReactNode;
  primary: React.ReactNode;
  onClick?: () => void;
  href?: string;
}

function NavLink(props: NavLinkProps) {
  const content = (
    <ListItem disablePadding>
      <ListItemButton onClick={props.onClick}>
        <ListItemIcon>{props.icon}</ListItemIcon>
        <ListItemText primary={props.primary} />
      </ListItemButton>
    </ListItem>
  );
  if (props.href) {
    return (
      <Link href={props.href} muiLinkProps={{ sx: { textDecoration: "none" } }}>
        {content}
      </Link>
    );
  }
  return content;
}

const drawerWidth = 240;

const Main = styled("main", { shouldForwardProp: (prop) => prop !== "open" })<{
  open?: boolean;
}>(({ theme, open }) => ({
  flexGrow: 1,
  padding: theme.spacing(3),
  transition: theme.transitions.create("margin", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  marginLeft: `-${drawerWidth}px`,
  ...(open && {
    transition: theme.transitions.create("margin", {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
    marginLeft: 0,
  }),
}));

interface AppBarProps extends MuiAppBarProps {
  open?: boolean;
}

const AppBar = styled(MuiAppBar, {
  shouldForwardProp: (prop) => prop !== "open",
})<AppBarProps>(({ theme, open }) => ({
  transition: theme.transitions.create(["margin", "width"], {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.leavingScreen,
  }),
  ...(open && {
    width: `calc(100% - ${drawerWidth}px)`,
    marginLeft: `${drawerWidth}px`,
    transition: theme.transitions.create(["margin", "width"], {
      easing: theme.transitions.easing.easeOut,
      duration: theme.transitions.duration.enteringScreen,
    }),
  }),
}));

const DrawerHeader = styled("div")(({ theme }) => ({
  display: "flex",
  alignItems: "center",
  padding: theme.spacing(0, 1),
  // necessary for content to be below app bar
  ...theme.mixins.toolbar,
  justifyContent: "flex-end",
}));

export function MainAdminLayout({
  children,
  hasAccess,
}: {
  children: React.ReactNode;
  hasAccess: boolean;
}) {
  const theme = useTheme();
  const [open, setOpen] = React.useState(true);
  const { status } = useSession();

  useLoginRedirect();

  const handleDrawerOpen = () => {
    setOpen(true);
  };

  const handleDrawerClose = () => {
    setOpen(false);
  };

  if (status !== "authenticated") {
    return null;
  }

  return (
    <Stack
      sx={{
        backgroundColor: "dark.main",
        backgroundImage: "linear-gradient(-15deg, #2C6964, #013D39)",
        minHeight: "100vh",
        width: "100%",
        overflowX: "scroll",
      }}
    >
      <Box sx={{ display: "flex" }}>
        <AppBar position="fixed" open={open}>
          <Toolbar>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              onClick={handleDrawerOpen}
              edge="start"
              sx={{ mr: 2, ...(open && { display: "none" }) }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" noWrap component="div">
              TTV Admin
            </Typography>
          </Toolbar>
        </AppBar>
        <Drawer
          sx={{
            width: drawerWidth,
            flexShrink: 0,
            "& .MuiDrawer-paper": {
              width: drawerWidth,
              boxSizing: "border-box",
            },
          }}
          variant="persistent"
          anchor="left"
          open={open}
        >
          <DrawerHeader>
            <IconButton onClick={handleDrawerClose}>
              {theme.direction === "ltr" ? (
                <ChevronLeftIcon />
              ) : (
                <ChevronRightIcon />
              )}
            </IconButton>
          </DrawerHeader>
          <Divider />
          <List>
            <NavLink
              icon={<PiTable fontSize={25} />}
              primary="Applications"
              href="/admin/application"
            />
          </List>
          <Box sx={{ flexGrow: 1 }} />
          <Divider />
          <List>
            <NavLink
              icon={<PiSignOutDuotone fontSize={25} />}
              primary="Logout"
              href="/auth/logout"
            />
          </List>
        </Drawer>
        <Main open={open}>
          <DrawerHeader />
          {children}
        </Main>
      </Box>
    </Stack>
  );
}
