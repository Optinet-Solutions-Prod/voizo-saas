import { redirect } from "next/navigation";

// Phone numbers live under Settings since the SaaS work (2026-09-24); keep the old URL working.
export default function PhoneNumbersPage() {
  redirect("/settings?tab=phone-numbers");
}
