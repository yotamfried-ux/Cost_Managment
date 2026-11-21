import type { Metadata } from "next";
import "@fontsource-variable/heebo";
import "./globals.css";

export const metadata: Metadata = {
  title: "D2R Management",
  description: "מערכת פרטית לניהול הכספים של העסק",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="he" dir="rtl"><body>{children}</body></html>;
}
