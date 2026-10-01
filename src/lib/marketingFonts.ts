// Marketing-site typography (landing + sign-in), restyled after deepgram.com on 2026-10-01:
// Inter for text and headings, Fira Code for the uppercase mono eyebrow labels. (Deepgram's
// heading face, Roobert, is a licensed font, so Inter with tight tracking stands in for it.)
// Loaded here, not in the root layout, so the console keeps Geist and pays nothing for these.
import { Fira_Code, Inter } from "next/font/google";

export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
export const firaCode = Fira_Code({ subsets: ["latin"], variable: "--font-fira-code", display: "swap" });

/** Class names that switch a page to the marketing theme (see .dg-site in globals.css). */
export const MARKETING_SHELL = `dg-site ${inter.variable} ${firaCode.variable}`;
