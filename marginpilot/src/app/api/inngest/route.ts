import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { functions as ai } from "@/jobs/ai";
import { functions as cleanup } from "@/jobs/cleanup";
import { functions as ebay } from "@/jobs/ebay";
import { functions as lister } from "@/jobs/lister";
import { functions as monitor } from "@/jobs/monitor";
import { functions as orders } from "@/jobs/orders";

export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [...ebay, ...lister, ...monitor, ...orders, ...cleanup, ...ai],
});
