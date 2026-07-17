import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { GuestProvider } from "@/contexts/GuestContext";
import { AuthPromptModal, GuestBanner } from "@/components/auth/AuthPrompt";
import ErrorBoundary from "@/components/ErrorBoundary";
import RibbonsCursor from "@/components/ui/RibbonsCursor";
import { useVisualEffectsStore } from "@/stores/visualEffectsStore";
import { ProtectedRoute } from "@/components/routing/ProtectedRoute";
import { EncryptionFlow } from "@/components/encryption/EncryptionFlow";
import Dashboard from "./pages/Dashboard";
import Notebook from "./pages/Notebook";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";
import VerifyEmail from "./pages/VerifyEmail";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import { useState, useEffect } from "react";
import { Analytics, type BeforeSendEvent } from "@vercel/analytics/react";

const queryClient = new QueryClient();

const redactAnalyticsEvent = (event: BeforeSendEvent): BeforeSendEvent | null => {
  try {
    const url = new URL(event.url);
    if (url.pathname === "/verify-email") return null;
    if (url.pathname.startsWith("/notebook")) {
      return { ...event, url: `${url.origin}/notebook` };
    }
    url.search = "";
    url.hash = "";
    return { ...event, url: url.toString() };
  } catch {
    return null;
  }
};

import GlobalSearch from "@/components/dashboard/GlobalSearch";
// ...
const AppContent = () => {
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      <Analytics beforeSend={redactAnalyticsEvent} />
      <GuestBanner />
      <GlobalSearch open={searchOpen} setOpen={setSearchOpen} />
      <Routes>
        {/* Dedicated authentication route */}
        <Route 
          path="/auth" 
          element={
            <EncryptionFlow 
              onUnlocked={() => navigate('/', { replace: true })} 
              allowGuest={true}
            />
          } 
        />
        
        {/* Email verification route */}
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        
        {/* Protected routes - require encryption/authentication */}
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/notebook" 
          element={
            <ProtectedRoute>
              <Notebook />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/notebook/:id" 
          element={
            <ProtectedRoute>
              <Notebook />
            </ProtectedRoute>
          } 
        />
        
        {/* Settings route - protected */}
        <Route 
          path="/settings" 
          element={
            <ProtectedRoute>
              <Settings />
            </ProtectedRoute>
          } 
        />
        
        {/* Guest mode route - unprotected (if needed in future) */}
        {/* <Route path="/guest" element={<GuestMode />} /> */}
        
        {/* 404 */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <AuthPromptModal />
    </>
  );
};

const AppWithEffects = () => {
  const { ribbonCursorEnabled, ribbonCount, ribbonOpacity, ribbonThickness, useCustomFonts } = useVisualEffectsStore();
  
  return (
    <div className={useCustomFonts ? 'font-body' : ''}>
      <RibbonsCursor 
        enabled={ribbonCursorEnabled}
        ribbonCount={ribbonCount}
        opacity={ribbonOpacity}
        thickness={ribbonThickness}
      />
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ErrorBoundary 
          variant="page"
          title="Application Error"
          message="We're sorry, but something went wrong. Please try refreshing the page."
        >
          <AppContent />
        </ErrorBoundary>
      </BrowserRouter>
    </div>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <GuestProvider>
          <AppWithEffects />
        </GuestProvider>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
