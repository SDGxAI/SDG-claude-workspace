import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDG Landingpage-Editor",
  description: "Interne Web-App zur gemeinsamen Bearbeitung von Landingpages",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        {children}
      </body>
    </html>
  );
}
