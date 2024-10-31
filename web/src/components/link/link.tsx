import NextLink, { LinkProps as NextLinkProps } from "next/link";
import { Link as MUILink, LinkProps as MuiLinkProps } from "@mui/material";

interface LinkProps extends NextLinkProps {
  muiLinkProps?: MuiLinkProps;
  children: React.ReactNode;
}

export function Link(props: LinkProps) {
  const { muiLinkProps, children, ...nextLinkProps } = props;
  return (
    <NextLink passHref legacyBehavior {...nextLinkProps}>
      <MUILink {...muiLinkProps} target="_blank">
        {children}
      </MUILink>
    </NextLink>
  );
}
