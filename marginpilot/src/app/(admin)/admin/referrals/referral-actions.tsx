"use client";

import { useActionState } from "react";
import { FormMessage, TextArea, type ActionState } from "@/components/ui/form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { CommissionStatus, ReferralStatus } from "@/lib/referrals/commission";
import { updateReferral } from "./actions";

/** Per-referral admin controls: the allowed transitions plus an optional note recorded with them. */
export function ReferralActions({
  id,
  status,
  commissionStatus,
  label,
}: {
  id: string;
  status: ReferralStatus;
  commissionStatus: CommissionStatus | null;
  label: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateReferral, null);
  const canApprove = status === "converted" && commissionStatus === "pending";
  const canPay = commissionStatus === "approved";
  const canVoid = status === "signed_up" || commissionStatus === "pending" || commissionStatus === "approved";

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <TextArea id={`note-${id}`} name="note" label="Note (optional)" rows={2} maxLength={1000} hint="Saved with the change, e.g. payout reference." />
      <div className="flex flex-wrap gap-2">
        {canApprove && (
          <SubmitButton name="op" value="approve" pendingText="Saving…" aria-label={`Approve commission for ${label}`}>
            Approve
          </SubmitButton>
        )}
        {canPay && (
          <SubmitButton name="op" value="paid" pendingText="Saving…" aria-label={`Mark commission paid for ${label}`}>
            Mark paid
          </SubmitButton>
        )}
        {canVoid && (
          <SubmitButton name="op" value="void" variant="secondary" pendingText="Saving…" className="text-danger" aria-label={`Void referral ${label}`}>
            Void
          </SubmitButton>
        )}
        <SubmitButton name="op" value="note" variant="secondary" pendingText="Saving…" aria-label={`Add note to ${label}`}>
          Add note
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
