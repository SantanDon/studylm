import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, KeyRound, ArrowLeft } from "lucide-react";

interface RecoveryViewProps {
  onBack: () => void;
  onSuccess: () => void;
}

export const RecoveryView = ({ onBack, onSuccess }: RecoveryViewProps) => {
  const [step, setStep] = useState<"identify" | "reset">("identify");
  const [displayName, setDisplayName] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  
  const [loading, setLoading] = useState(false);
  const { recoverAccount, resetPassphrase } = useAuth();
  const { toast } = useToast();

  const handleRecover = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await recoverAccount(displayName, recoveryKey);
      setResetToken(data.resetToken);
      setStep("reset");
      toast({
        title: "Phrase Verified",
        description: "Recovery Case accepted. Please set your new passphrase.",
      });
    } catch (err) {
      toast({
        title: "Recovery Failed",
        description: err instanceof Error ? err.message : "Invalid recovery phrase or display name",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassphrase !== confirmPassphrase) {
      toast({
        title: "Mismatch",
        description: "Passphrases do not match.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      await resetPassphrase(resetToken, newPassphrase);
      toast({
        title: "Account Restored",
        description: "Your passphrase has been updated and you are now logged in.",
      });
      onSuccess();
    } catch (err) {
      toast({
        title: "Reset Failed",
        description: err instanceof Error ? err.message : "Failed to reset passphrase",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-md mx-auto p-6 bg-card rounded-xl border shadow-2xl">
      <div className="text-center space-y-2">
        <div className="flex justify-center">
          <div className="p-3 bg-emerald-500/10 rounded-full">
            <ShieldCheck className="w-8 h-8 text-emerald-500" />
          </div>
        </div>
        <h2 className="text-2xl font-semibold text-foreground tracking-tight">
          {step === "identify" ? "Recovery Case" : "New Security Anchor"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {step === "identify" 
            ? "Enter your 24-word recovery phrase to regain access." 
            : "Set a strong new passphrase for your account."}
        </p>
      </div>

      {step === "identify" ? (
        <form onSubmit={handleRecover} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">Account Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Satoshi"
              disabled={loading}
              required
              className="bg-background/50 border-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="recoveryKey">24-Word Phrase</Label>
            <textarea
              id="recoveryKey"
              value={recoveryKey}
              onChange={(e) => setRecoveryKey(e.target.value)}
              placeholder="word1 word2 word3..."
              disabled={loading}
              required
              rows={4}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 border-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying Phrase...
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4 mr-2" />
                  Verify Recovery Case
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              disabled={loading}
              className="text-muted-foreground"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Login
            </Button>
          </div>
        </form>
      ) : (
        <form onSubmit={handleReset} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="newPassphrase">New Passphrase</Label>
            <Input
              id="newPassphrase"
              type="password"
              value={newPassphrase}
              onChange={(e) => setNewPassphrase(e.target.value)}
              placeholder="At least 8 characters"
              disabled={loading}
              required
              minLength={8}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassphrase">Confirm New Passphrase</Label>
            <Input
              id="confirmPassphrase"
              type="password"
              value={confirmPassphrase}
              onChange={(e) => setConfirmPassphrase(e.target.value)}
              placeholder="Repeat your password"
              disabled={loading}
              required
              minLength={8}
            />
          </div>

          <div className="pt-2">
            <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Securing Account...
                </>
              ) : (
                "Reset & Login"
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};
