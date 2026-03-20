"use client";

import { useEffect } from "react";
import { ThemeProvider } from "next-themes";

export function Providers(props: { children: React.ReactNode }) {
  useEffect(() => {
    function preventBrowserZoom(event: Event) {
      event.preventDefault();
    }

    function preventPinchZoom(event: TouchEvent) {
      if (event.touches.length > 1) event.preventDefault();
    }

    function preventDoubleTapZoom() {
      let lastTouchEnd = 0;

      return (event: TouchEvent) => {
        const now = Date.now();
        if (now - lastTouchEnd <= 300) event.preventDefault();
        lastTouchEnd = now;
      };
    }

    const handleTouchEnd = preventDoubleTapZoom();

    document.addEventListener("gesturestart", preventBrowserZoom, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gesturechange", preventBrowserZoom, { passive: false } as AddEventListenerOptions);
    document.addEventListener("gestureend", preventBrowserZoom, { passive: false } as AddEventListenerOptions);
    document.addEventListener("touchmove", preventPinchZoom, { passive: false });
    document.addEventListener("touchend", handleTouchEnd, { passive: false });

    return () => {
      document.removeEventListener("gesturestart", preventBrowserZoom as EventListener);
      document.removeEventListener("gesturechange", preventBrowserZoom as EventListener);
      document.removeEventListener("gestureend", preventBrowserZoom as EventListener);
      document.removeEventListener("touchmove", preventPinchZoom as EventListener);
      document.removeEventListener("touchend", handleTouchEnd as EventListener);
    };
  }, []);

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
