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

// Absolute base for OG/Twitter image URLs. Vercel injects the production
// host; falls back to localhost for local dev.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "FormWatch — EPL form anomaly detection",
    template: "%s · FormWatch",
  },
  description:
    "Bayesian surveillance of Premier League player form: breakouts, slumps and role changes separated from noise, explained by AI.",
  openGraph: {
    type: "website",
    siteName: "FormWatch",
    title: "FormWatch — EPL form anomaly detection",
    description:
      "Player form, audited weekly. Gamma-Poisson posteriors nominate the movers, Benjamini-Hochberg keeps the false positives out.",
  },
  twitter: {
    card: "summary_large_image",
  },
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
