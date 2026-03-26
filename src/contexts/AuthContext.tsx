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

  const signIn = (user: LocalUser, session: LocalSession) => {
    console.log("AuthContext: Starting sign in process...", user.email);

    try {
      localStorage.setItem("currentSession", JSON.stringify(session));
      localStorageService.setCurrentUser(user);
      updateAuthState(user, session);
      console.log("AuthContext: Sign in successful for", user.email);
    } catch (err) {
      console.error("AuthContext: Sign in error:", err);
      setError(err instanceof Error ? err.message : "Sign in error");
    }
  };

  const signInWithCloud = (userData: { id: string; email?: string; displayName?: string; account_type?: string; createdAt: string }, sessionData: { accessToken: string; refreshToken: string }) => {
    console.log("AuthContext: Cloud sign in successful", userData.displayName);
    const { setUnlockedOnly } = useEncryptionStore.getState();
    const guestId = localStorage.getItem("guest_id");
    
    try {
      const mappedUser: LocalUser = {
        id: userData.id,
        email: userData.email || `${userData.displayName}@agent.local`,
        displayName: userData.displayName,
        account_type: userData.account_type,
        created_at: userData.createdAt
      };

      const mappedSession: LocalSession = {
        access_token: sessionData.accessToken,
        refresh_token: sessionData.refreshToken,
        expires_at: Date.now() + 3600000, // 1 hour
        user: mappedUser
      };

      localStorage.setItem("currentSession", JSON.stringify(mappedSession));
      localStorageService.setCurrentUser(mappedUser);
      setUnlockedOnly(userData.id);
      updateAuthState(mappedUser, mappedSession);

      // Trigger migration of Guest data to Cloud backend asynchronously
      if (guestId) {
        migrateLocalToCloud(guestId, sessionData.accessToken).catch(err => {
          console.error("Local-to-Cloud migration failed:", err);
        });
      }
    } catch (err) {
      console.error("AuthContext: Cloud sign in mapping error:", err);
      setError("Cloud sign in failed");
    }
  };

  const signOut = async () => {
    try {
      console.log("AuthContext: Starting logout process...");

      // Clear local storage
      localStorageService.setCurrentUser(null);
      localStorage.removeItem("currentSession");

      // Clear local state immediately
      clearAuthState();

      console.log("AuthContext: Logout successful");
    } catch (err) {
      console.error("AuthContext: Unexpected logout error:", err);

      // Even if there's an error, try to clear local session
      try {
        localStorageService.setCurrentUser(null);
        localStorage.removeItem("currentSession");
        clearAuthState();
      } catch (localError) {
        console.error(
          "AuthContext: Failed to clear local session:",
          localError,
        );
      }
    }
  };

  useEffect(() => {
    let mounted = true;

    const initializeAuth = () => {
      try {
        console.log("AuthContext: Initializing auth...");

        // Get user from local storage
        const currentUser = localStorageService.getCurrentUser();
        const sessionData = safeGetItem("currentSession");

        if (currentUser && sessionData) {
          try {
            const session = safeParseJSON<LocalSession>(sessionData);
            if (mounted) {
              console.log(
                "AuthContext: Found existing session:",
                currentUser.email,
              );
              updateAuthState(currentUser, session);
            }
          } catch (parseError) {
            console.error("Error parsing session data:", parseError);
            if (mounted) {
              // Clear corrupted session data
              localStorage.removeItem("currentSession");
              updateAuthState(null, null);
            }
          }
        } else if (mounted) {
          console.log("AuthContext: No existing session found");
          updateAuthState(null, null);
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
    signOut,
    signIn,
    signInWithCloud,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// Export the custom hook for use in components
export { useAuth };