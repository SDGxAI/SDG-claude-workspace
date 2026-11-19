import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Freundliche, gut lesbare Schrift (wird beim Bauen eingebunden, kein Abruf
// bei Google im Browser).
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: "SDG Sites",
  description: "Interne Web-App zur gemeinsamen Bearbeitung von Landingpages",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={`h-full antialiased ${jakarta.variable}`}>
      <body className="min-h-full flex flex-col text-neutral-900">
        {children}
      </body>
    </html>
  );
}
