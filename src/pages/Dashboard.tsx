import React from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import NotebookGrid from "@/components/dashboard/NotebookGrid";
import EmptyDashboard from "@/components/dashboard/EmptyDashboard";
import WhatsHappening from "@/components/dashboard/WhatsHappening";
import GoalsPulse from "@/components/dashboard/GoalsPulse";
import MetallicText from "@/components/ui/MetallicText";
import { useNotebooks } from "@/hooks/useNotebooks";
import { useAuth } from "@/hooks/useAuth";
import { useGuest } from "@/hooks/useGuest";
import { useVisualEffectsStore } from "@/stores/visualEffectsStore";
import { FEATURE_FLAGS } from "@/config/featureFlags";

const Dashboard = () => {
  const { user, loading: authLoading, error: authError } = useAuth();
  const { notebooks, isLoading, error, isError } = useNotebooks();
  const { metallicTextEnabled, metallicTextSpeed, useCustomFonts } = useVisualEffectsStore();
  const hasNotebooks = notebooks && notebooks.length > 0;

  // Show loading while auth is initializing
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPodLM
            </h1>
          </div>
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-muted-foreground">Initializing...</p>
          </div>
        </main>
      </div>
    );
  }

  // Show auth error if present
  if (authError) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPodLM
            </h1>
          </div>
          <div className="text-center py-16">
            <p className="text-red-600 dark:text-red-400">Authentication error: {authError}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  // Show notebooks loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPodLM
            </h1>
          </div>
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 dark:text-muted-foreground">Loading your notebooks...</p>
          </div>
        </main>
      </div>
    );
  }

  // Show notebooks error if present
  if (isError && error) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-background">
        <DashboardHeader userEmail={user?.email} />
        <main className="max-w-7xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-medium text-gray-900 dark:text-foreground mb-2">
              Welcome to StudyPodLM
            </h1>
          </div>
          <div className="text-center py-16">
            <p className="text-red-600 dark:text-red-400">Error loading notebooks: {error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-background">
      <DashboardHeader userEmail={user?.email} />

      <main className="max-w-7xl mx-auto px-6 py-[60px]">
        <div className="mb-8">
          <h1 className={`font-medium text-gray-900 dark:text-foreground mb-2 text-5xl ${useCustomFonts ? 'font-heading' : ''}`}>
            <MetallicText enabled={metallicTextEnabled} speed={metallicTextSpeed}>
              Welcome to StudyPodLM
            </MetallicText>
          </h1>
        </div>

        {hasNotebooks ? (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
            <div className="lg:col-span-3">
              <NotebookGrid />
            </div>
            <div className="lg:col-span-1 space-y-6">
              <GoalsPulse />
              {FEATURE_FLAGS.SIGNAL_QUEUE_VISIBLE && <WhatsHappening />}
            </div>
          </div>
        ) : (
          <EmptyDashboard />
        )}
      </main>
    </div>
  );
};

export default Dashboard;
