import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import branding from "../../branding.json";
import { Header, Footer } from "@/components/monterey/chrome";
import { SessionProvider } from "@/components/monterey/session-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taquería Monterey — Menú de ejemplo",
  description: "Demo ficticia de Esteban para probar Constructor. Explora ocho productos de ejemplo y guarda tu comanda. Sin cobros, preparación ni envío.",
  icons: { icon: "/brand-mark.svg", apple: "/brand-mark.svg" },
};
const localFontHashes = new Set([
  "b56db40c26850f83ba2ebffa1f7faa01e5ee4e55ac63decee1433de520a38483",
  "e1b454f5469f3d0d98c117651a4d15a8345ad77b50f09540b5cf61e82511b563",
  "284891c74c258cff7233962e048d9470bfb9fc326b53dd0bca408789297c3409",
  "913ee3631949ee1b4fb2601269412fca5775eb994d4f87be2c366c94ac123dc5",
  "daa4fc7275d21266748afad0563d8f57e075933686ca6995f06ed8619e99e9e4",
  "b5d9490cf95d925a28ab7b1560e76385134c9bca6cd2d83eee1e51d8c7b1295f",
]);
const fontCss = branding.brandbook.fontFaces.map(face => {
  const originalCopy = `https://odifhpxpphpkaucgsthd.supabase.co/storage/v1/object/public/screenshots/projects/P-8XX57R/brand/fonts/${face.sha256}.ttf`;
  const url = localFontHashes.has(face.sha256) && face.url === originalCopy ? `/fonts/${face.sha256}.ttf` : face.url;
  return `@font-face{font-family:${JSON.stringify(face.family)};src:url(${JSON.stringify(url)});font-weight:${face.weight};font-style:normal;font-display:swap;}`;
}).join("\n");

export default function RootLayout({ children }: { children: ReactNode }) {
  const apiOrigin = (process.env.NEXT_PUBLIC_CONSTRUCTOR_API || "https://constructor-api-git-dev-useconstructor.vercel.app").replace(/\/$/, "");
  const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || "P-8XX57R";
  return <html lang="es" style={{
    "--brand-background": branding.backgroundColor,
    "--brand-surface": branding.secondaryColor,
    "--brand-primary": branding.primaryColor,
    "--brand-accent": branding.accentColor,
    "--brand-text": branding.textColor,
    "--brand-font-heading": `"${branding.fontHeading}"`,
    "--brand-font-body": `"${branding.fontBody}"`,
  } as CSSProperties}>
    <head><style>{fontCss}</style></head>
    <body>
      <a className="skip-link" href="#contenido">Saltar al contenido</a>
      <SessionProvider><Header />{children}<Footer /></SessionProvider>
      <script src={"https://constructor-api-git-dev-useconstructor.vercel.app/v1/projects/P-8XX57R/analytics/script.js"} defer></script>
      <script src="/constructor-editor.js" defer />
    </body>
  </html>;
}
