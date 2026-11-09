import type { Metadata } from "next";
import { MenuPage } from "@/components/monterey/menu-page";

export const metadata: Metadata = { title: "Taquería Monterey — Menú de ejemplo" };
export default function Home() { return <MenuPage />; }
