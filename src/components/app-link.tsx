import type { AnchorHTMLAttributes } from "react";

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export function AppLink(props: AppLinkProps) {
  return <a {...props} />;
}
