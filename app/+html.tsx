import { ScrollViewStyleReset } from "expo-router/html";
import type { PropsWithChildren } from "react";

/**
 * Web and Node.js only
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />

        <ScrollViewStyleReset />

        <style>{`
          html, body, #root { height: 100%; overflow: hidden; }
        `}</style>
      </head>
      <body style={{ height: "100%" }}>{children}</body>
    </html>
  );
}
