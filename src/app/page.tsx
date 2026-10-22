import { Suspense } from "react";
import { ReviewApp } from "@/components/ReviewApp";

// The selected draft lives in the query string, which needs a Suspense boundary.
export default function Home() {
  return (
    <Suspense>
      <ReviewApp />
    </Suspense>
  );
}
