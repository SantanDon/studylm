import { createContext } from "react";
import { LocalUser } from "@/services/localStorageService";

export interface LocalSession {
  user: LocalUser;
  expires_at: number;
}

export interface AuthContextType {
  user: LocalUser | null;
  session: LocalSession | null;
  loading: boolean;
  error: string | null;
  isAuthenticated: boolean;
  mfaRequired: boolean;
  mfaToken: string | null;
  signOut: () => Promise<void>;
  signIn: (credentials: any) => Promise<void>;
  signInWithCloud: (userData: any) => void;
  verifyMfa: (code: string) => Promise<boolean>;
  recoverAccount: (displayName: string, recoveryKey: string) => Promise<{ resetToken: string }>;
  resetPassphrase: (resetToken: string, newPassphrase: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);
