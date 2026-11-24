import { Suspense } from "react";
import {
  AiToolsSection,
  CourseSection,
  FaqSection,
  FinalCta,
  Hero,
  HowItWorks,
  SoftwareFeatures,
} from "@/components/marketing/sections";
import { ResultsSection } from "@/components/marketing/results";
import { Pricing } from "@/components/marketing/pricing";

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <SoftwareFeatures />
      <AiToolsSection />
      <CourseSection />
      {/* Hidden entirely until there is approved proof in the database. */}
      <Suspense fallback={null}>
        <ResultsSection />
      </Suspense>
      <Pricing />
      <FaqSection />
      <FinalCta />
    </>
  );
}
