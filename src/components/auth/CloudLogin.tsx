import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/useAuth";
import { ApiService } from "@/services/apiService";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Globe, Mail } from "lucide-react";

interface CloudLoginProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  initialIsSignUp?: boolean;
}

export const CloudLogin = ({ onSuccess, onCancel, initialIsSignUp = false }: CloudLoginProps) => {
  const [isSignUp, setIsSignUp] = useState(initialIsSignUp);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState(""); // Only used for Sign Up
  const [tosAccepted, setTosAccepted] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  
  const { signInWithCloud } = useAuth();
  const { toast } = useToast();

  const handleCloudLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setUnverifiedEmail(null);

    // Basic validation
    if (isSignUp && !tosAccepted) {
      toast({
        title: "Terms Required",
        description: "You must agree to the Terms of Service to create an account.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    try {
      if (isSignUp) {
        // --- SIGN UP ---
        console.log("Attempting cloud signup for:", email);
        await ApiService.signup({ 
          email, 
          password, 
          displayName, 
          emailConsent: marketingConsent 
        });
        
        toast({
          title: "Account Created",
          description: "Please check your email to verify your account before logging in.",
        });
        
        // Reset to sign in mode after successful signup
        setIsSignUp(false);
      } else {
        // --- SIGN IN ---
        console.log("Attempting cloud login for:", email);
        const data = await ApiService.signin({ email, password });
        
        signInWithCloud(data.user, {
          accessToken: data.accessToken,
          refreshToken: data.refreshToken
        });

        toast({
          title: "Cloud session active",
          description: `Logged in as ${data.user.displayName}`,
        });

        onSuccess?.();
      }
    } catch (err) {
      console.error("Cloud auth error:", err);
      const error = err as { message?: string };
      const errMessage = error.message || "An unexpected error occurred";
      
      toast({
        title: isSignUp ? "Sign Up Failed" : "Login Failed",
        description: errMessage,
        variant: "destructive",
      });

      // Show resend button if the specific unverified error occurs
      if (!isSignUp && errMessage.toLowerCase().includes("not verified")) {
        setUnverifiedEmail(email);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedEmail) return;
    setLoading(true);
    try {
      await ApiService.resendVerification(unverifiedEmail);
      toast({
        title: "Verification Sent",
        description: `We've sent a new verification link to ${unverifiedEmail}.`,
      });
      setUnverifiedEmail(null);
    } catch (err) {
      const error = err as { message?: string };
      toast({
        title: "Failed to resend",
        description: error.message || "Could not send verification email.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="p-3 bg-blue-500/10 rounded-full">
            <Globe className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-foreground">
          {isSignUp ? "Create Cloud Account" : "Sign In to Cloud"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isSignUp 
            ? "Create an account to sync your notebooks and agents instantly." 
            : "Use your Cloud Credentials to access shared intelligence."}
        </p>
      </div>

      <form onSubmit={handleCloudLogin} className="space-y-4">
        {isSignUp && (
          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Satoshi Nakamoto"
              disabled={loading}
              required={isSignUp}
            />
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="email">Email Address</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
            disabled={loading}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
            disabled={loading}
            required
            minLength={6}
          />
        </div>

        {isSignUp && (
          <div className="space-y-4 py-2">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="tosAccepted" 
                checked={tosAccepted} 
                onCheckedChange={(checked) => setTosAccepted(checked as boolean)}
                disabled={loading}
              />
              <label
                htmlFor="tosAccepted"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                I agree to the <a href="#" className="underline">Terms of Service</a> (required)
              </label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="marketingConsent" 
                checked={marketingConsent} 
                onCheckedChange={(checked) => setMarketingConsent(checked as boolean)}
                disabled={loading}
              />
              <label
                htmlFor="marketingConsent"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                I'd like to receive product updates from StudyPodLM (optional)
              </label>
            </div>
          </div>
        )}

        <div className="pt-2 flex flex-col gap-2">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {isSignUp ? "Creating Account..." : "Authenticating..."}
              </>
            ) : (
              isSignUp ? "Create Account" : "Login to Cloud"
            )}
          </Button>

          {unverifiedEmail && !isSignUp && (
            <Button
              type="button"
              variant="outline"
              onClick={handleResendVerification}
              disabled={loading}
              className="w-full border-yellow-500/50 hover:bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 mt-2"
            >
              <Mail className="w-4 h-4 mr-2" />
              Resend Verification Email
            </Button>
          )}
          
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setIsSignUp(!isSignUp);
              setUnverifiedEmail(null);
            }}
            disabled={loading}
          >
            {isSignUp ? "Already have an account? Sign In" : "Need an account? Sign Up"}
          </Button>
          
          {onCancel && !isSignUp && (
            <Button
              type="button"
              variant="link"
              onClick={onCancel}
              disabled={loading}
              className="text-xs text-muted-foreground"
            >
              Back to Local Unlock
            </Button>
          )}
        </div>
      </form>
    </div>
  );
};
