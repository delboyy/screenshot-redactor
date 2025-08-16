"use client";

import React from "react";
import Link from "next/link";
import ManualRedactor from "@/components/redactor/ManualRedactor";

export default function RedactPage() {
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const dataUrl = sessionStorage.getItem("sr:imageDataURL");
    if (!dataUrl) {
      setError("No image found. Go back and upload a screenshot.");
      return;
    }

    // We just check existence here now; drawing handled by ManualRedactor
  }, []);

  return (
    <div className="mx-auto max-w-5xl w-full p-4 sm:p-6 md:p-10">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Redact</h1>
        <Link href="/" className="text-sm text-muted-foreground underline">Start over</Link>
      </div>
      {error ? (
        <p className="text-destructive">{error}</p>
      ) : (
        <ManualRedactor />
      )}
    </div>
  );
}


