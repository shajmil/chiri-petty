import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import "@fontsource/anek-malayalam/latin-400.css";
import "@fontsource/anek-malayalam/latin-600.css";
import "@fontsource/anek-malayalam/malayalam-400.css";
import "@fontsource/anek-malayalam/malayalam-600.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chiri Party — കൂട്ടുകാരുടെ ശബ്ദക്കളി",
  description:
    "A Malayalam voice party. Listen, imitate, laugh, repeat. Original sound packs and private rooms for friends.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ml">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
