import React, {
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { AuthContext, AuthContextType } from "./AuthContextInstance";
import { LocalUser, LocalSession } from "@/services/localStorageService";
import { localStorageService } from "@/services/localStorageService";
import { useEncryptionStore } from "@/stores/encryptionStore";
import { safeGetItem, safeParseJSON } from "@/lib/utils/contextUtils";
import { migrateLocalToCloud } from "@/lib/sync/localToCloudMigration";
import { ApiService } from "@/services/apiService";


interface AuthProviderProps {
  children: ReactNode;
}

// Custom hook for easy access to auth context
const useAuth = () => {
  const context = React.useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<LocalUser | null>(null);
  const [session, setSession] = useState<LocalSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState<string | null>(null);

  const updateAuthState = useCallback(
    (newUser: LocalUser | null, newSession: LocalSession | null) => {
      console.log(
        "AuthContext: Updating auth state:",
        newUser?.email || newUser?.displayName || "No user",
      );
      setUser(newUser);
      setSession(newSession);
      setError((prev) => (newUser && prev ? null : prev));
    },
    [],
  );

  const clearAuthState = useCallback(() => {
    console.log("AuthContext: Clearing auth state");
    setUser(null);
    setSession(null);
    setError(null);
  }, []);

  const signIn = async (credentials: any) => {
    console.log("AuthContext: Starting sign in process...");
    setError(null);
    try {
      const data = await ApiService.signin(credentials);
      
      if (data.mfaRequired) {
        setMfaRequired(true);
        setMfaToken(data.mfaToken);
        return;
      }

      signInWithCloud(data.user);
    } catch (err) {
      console.error("AuthContext: Sign in error:", err);
      setError(err instanceof Error ? err.message : "Sign in error");
    }
  };

  const signInWithCloud = (userData: { id: string; email?: string; displayName?: string; account_type?: string; createdAt: string }) => {
    console.log("AuthContext: Cloud sign in successful", userData.displayName);
    const { setUnlockedOnly } = useEncryptionStore.getState();
    
    try {
      const mappedUser: LocalUser = {
        id: userData.id,
        email: userData.email || `${userData.displayName}@agent.local`,
        displayName: userData.displayName,
        account_type: userData.account_type,
        created_at: userData.createdAt
      };

      // In cookie mode, we don't store tokens in LocalSession
      const mappedSession: LocalSession = {
        access_token: "SESSION_MANAGED_BY_COOKIE",
        refresh_token: "SESSION_MANAGED_BY_COOKIE",
        expires_at: Date.now() + 3600000, // Placeholder
        user: mappedUser
      };

      localStorage.setItem("currentSession", JSON.stringify(mappedSession));
      localStorageService.setCurrentUser(mappedUser);
      setUnlockedOnly(userData.id);
      updateAuthState(mappedUser, mappedSession);
      setMfaRequired(false);
      setMfaToken(null);

    } catch (err) {
      console.error("AuthContext: Cloud sign in mapping error:", err);
      setError("Cloud sign in failed");
    }
  };

  const verifyMfa = async (code: string) => {
    if (!mfaToken) {
      setError("MFA session expired. Please sign in again.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await ApiService.mfaVerify(mfaToken, code);
      signInWithCloud(data.user);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "MFA verification failed";
      setError(msg);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      console.log("AuthContext: Starting logout process...");

      // Call backend to clear cookies
      await ApiService.signout().catch(err => console.warn("Signout request failed, continuing local clear", err));

      // Clear local storage
      localStorageService.setCurrentUser(null);
      localStorage.removeItem("currentSession");

      // Clear local state immediately
      clearAuthState();

      console.log("AuthContext: Logout successful");
    } catch (err) {
      console.error("AuthContext: Unexpected logout error:", err);
      // ... same cleanup
      localStorageService.setCurrentUser(null);
      localStorage.removeItem("currentSession");
      clearAuthState();
    }
  };

  useEffect(() => {
    let mounted = true;

    const initializeAuth = async () => {
      try {
        console.log("AuthContext: Initializing auth...");

        // In cookie mode, we verify by calling /api/user/profile
        // This is safer than trusting localStorage
        try {
          const profileData = await ApiService.getUser("COOKIE_SESSION");
          if (mounted && profileData.user) {
            console.log("AuthContext: Verified session via cookie for", profileData.user.email);
            
            const mappedUser: LocalUser = {
              id: profileData.user.id,
              email: profileData.user.email,
              displayName: profileData.user.displayName,
              account_type: profileData.user.account_type || 'cloud',
              created_at: profileData.user.createdAt
            };

            const mappedSession: LocalSession = {
              access_token: "SESSION_MANAGED_BY_COOKIE",
              refresh_token: "SESSION_MANAGED_BY_COOKIE",
              expires_at: Date.now() + 3600000,
              user: mappedUser
            };

            updateAuthState(mappedUser, mappedSession);
            setLoading(false);
            return;
          }
        } catch (authErr) {
          console.warn("AuthContext: No active cookie session or verification failed", authErr);
        }

        // Fallback for Guest/Local only if no cookie session
        const currentUser = localStorageService.getCurrentUser();
        const sessionData = safeGetItem("currentSession");

        if (currentUser && sessionData) {
          try {
            const session = safeParseJSON<LocalSession>(sessionData);
            if (mounted) {
              console.log("AuthContext: Found existing local/guest session:", currentUser.email);
              updateAuthState(currentUser, session);
            }
          } catch (parseError) {
            console.error("Error parsing local session data:", parseError);
          }
        }

        if (mounted) {
          setLoading(false);
        }
      } catch (err) {
        console.error("AuthContext: Auth initialization error:", err);
        if (mounted) {
          setError(err instanceof Error ? err.message : "Authentication error");
          setLoading(false);
        }
      }
    };

    // Initialize auth state synchronously
    initializeAuth();

    return () => {
      mounted = false;
    };
  }, [updateAuthState]); // updateAuthState is stable via useCallback

  const value: AuthContextType = {
    user,
    session,
    loading,
    error,
    isAuthenticated: !!user && !!session,
    mfaRequired,
    mfaToken,
    signOut,
    signIn,
    signInWithCloud,
    verifyMfa,
    recoverAccount: async (displayName: string, recoveryKey: string) => {
      setError(null);
      try {
        return await ApiService.recover(displayName, recoveryKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Recovery failed";
        setError(msg);
        throw new Error(msg);
      }
    },
    resetPassphrase: async (resetToken: string, newPassphrase: string) => {
      setError(null);
      try {
        const data = await ApiService.resetPassphrase(resetToken, newPassphrase);
        if (data.user) {
          // Auto-login after reset
          signInWithCloud(data.user);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Reset failed";
        setError(msg);
        throw new Error(msg);
      }
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Export the custom hook for use in components
export { useAuth };