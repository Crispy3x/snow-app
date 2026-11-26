import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/account/auth-card";
import { ForgotForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Reset your password"
      intro="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={
        <p>
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-accent underline underline-offset-2 hover:text-accent-strong">
            Back to log in
          </Link>
        </p>
      }
    >
      <ForgotForm />
    </AuthCard>
  );
}
