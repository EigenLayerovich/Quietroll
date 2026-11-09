import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quietroll - discreet batch payouts on Solana",
  description:
    "Pay contributors, sellers and token holders from one sheet. Non-custodial, compliance-screened, and routed so your payroll is not one public transaction.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
