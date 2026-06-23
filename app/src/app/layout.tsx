import type { Metadata } from "next";
import { Saira, Saira_Condensed, Spline_Sans_Mono } from "next/font/google";
import { Suspense } from "react";

import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

import "./globals.css";

const saira = Saira({
  subsets: ["latin"],
  variable: "--font-saira",
});

const sairaCondensed = Saira_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-saira-cond",
});

const splineMono = Spline_Sans_Mono({
  subsets: ["latin"],
  variable: "--font-spline-mono",
});

export const metadata: Metadata = {
  title: {
    default: "FormWatch — EPL form anomaly detection",
    template: "%s · FormWatch",
  },
  description:
    "Bayesian surveillance of Premier League player form: breakouts, slumps and role changes separated from noise, explained by AI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${saira.variable} ${sairaCondensed.variable} ${splineMono.variable} dark h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SiteNav />
        <main className="flex-1">{children}</main>
        <Suspense fallback={null}>
          <SiteFooter />
        </Suspense>
      </body>
    </html>
  );
}
