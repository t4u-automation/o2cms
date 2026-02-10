"use client";

import { useState } from "react";

interface OnboardingScreenProps {
  onSubmit: (companyName: string) => Promise<unknown>;
}

export default function OnboardingScreen({ onSubmit }: OnboardingScreenProps) {
  const [companyName, setCompanyName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!companyName.trim()) {
      setError("Please enter a company name");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await onSubmit(companyName.trim());
    } catch (err) {
      console.error("[OnboardingScreen] Error:", err);
      setError("Failed to complete setup. Please try again.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--background-gray-main)] p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-[16px] border border-[var(--border-main)] p-8 shadow-sm">
          <h1 className="text-2xl font-semibold text-[var(--text-primary)] mb-2">
            Welcome to O2 CMS
          </h1>
          <p className="text-[var(--text-secondary)] mb-6">
            Let's get started by setting up your workspace
          </p>

          <form onSubmit={handleSubmit}>
            <div className="mb-6">
              <label
                htmlFor="companyName"
                className="block text-sm font-medium text-[var(--text-primary)] mb-2"
              >
                Company Name
              </label>
              <input
                id="companyName"
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="Enter your company name"
                className="w-full px-4 py-3 bg-white border border-[var(--border-main)] rounded-[8px] text-[var(--text-primary)] placeholder:text-[var(--text-disable)] focus:outline-none focus:border-[var(--border-input-active)]"
                disabled={isSubmitting}
                autoFocus
              />
              {error && (
                <p className="mt-2 text-sm text-red-600">{error}</p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full px-4 py-3 bg-[var(--Button-primary-black)] text-white rounded-[8px] font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "Setting up..." : "Continue"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

