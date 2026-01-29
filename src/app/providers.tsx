"use client";

import { ThemeProvider } from "next-themes";

export function Providers(props: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {props.children}
    </ThemeProvider>
  );
}
