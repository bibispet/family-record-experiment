import type { Metadata } from "next";
import { Geist, Lora } from "next/font/google";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const serif = Lora({ variable: "--font-serif", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Lore Family Demo", template: "%s · Lore Family Demo" },
  description: "A fictional, seed-only demo of a private family-record interaction model.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable}`}>
        <aside className="demo-banner" role="note">
          <strong>Read-only demo.</strong> Every person and story is fictional. Nothing can be entered, uploaded, or saved.
        </aside>
        {children}
      </body>
    </html>
  );
}
