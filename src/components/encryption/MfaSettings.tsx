import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';
import { ApiService } from '@/services/apiService';
import { useToast } from '@/hooks/use-toast';
import { Shield, Smartphone, Lock, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function MfaSettings() {
  const { user, session } = useAuth();
  const { toast } = useToast();
  
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const [step, setStep] = useState<'initial' | 'verify'>('initial');
  const [setupData, setSetupData] = useState<{ secret: string; qrCode: string } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [loading, setLoading] = useState(false);

  // Note: user.twoFactorEnabled will be available after the next profile refresh or if updated in state
  const isEnabled = user?.twoFactorEnabled;

  const handleStartSetup = async () => {
    setLoading(true);
    try {
      const data = await ApiService.mfaSetup(session?.access_token || '');
      setSetupData(data);
      setStep('verify');
      setIsSetupOpen(true);
    } catch (err) {
      toast({
        title: "Setup Failed",
        description: err instanceof Error ? err.message : "Could not initialize MFA",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndEnable = async () => {
    if (verificationCode.length !== 6) return;
    setLoading(true);
    try {
      await ApiService.mfaEnable(verificationCode, session?.access_token || '');
      toast({
        title: "MFA Enabled",
        description: "Your account is now protected with 2FA.",
      });
      setIsSetupOpen(false);
      // We should ideally refresh the user context here
      window.location.reload(); 
    } catch (err) {
      toast({
        title: "Verification Failed",
        description: err instanceof Error ? err.message : "Invalid code",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDisable = async () => {
    const code = prompt("Please enter your current MFA code to disable 2FA:");
    if (!code) return;

    setLoading(true);
    try {
      await ApiService.mfaDisable(code, session?.access_token || '');
      toast({
        title: "MFA Disabled",
        description: "Two-factor authentication has been turned off.",
      });
      window.location.reload();
    } catch (err) {
      toast({
        title: "Disable Failed",
        description: err instanceof Error ? err.message : "Invalid code",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="border-emerald-500/20 bg-emerald-500/5 backdrop-blur-sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isEnabled ? 'bg-emerald-500/20 text-emerald-500' : 'bg-blue-500/20 text-blue-500'}`}>
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <CardTitle>Multi-Factor Authentication</CardTitle>
            <CardDescription>
              Protect your account with a secondary verification code
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-white/5 border border-white/10">
          <div className="space-y-1">
            <h4 className="font-medium flex items-center gap-2">
              Authenticator App
              {isEnabled && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
            </h4>
            <p className="text-sm text-muted-foreground">
              {isEnabled 
                ? "Verified and active on your account" 
                : "Generate codes using Google Authenticator, Authy, or Microsoft Authenticator"}
            </p>
          </div>
          
          {isEnabled ? (
            <Button 
              variant="outline" 
              className="border-destructive/50 text-destructive hover:bg-destructive/10"
              onClick={handleDisable}
              disabled={loading}
            >
              Disable 2FA
            </Button>
          ) : (
            <Button 
              className="premium-gradient-button"
              onClick={handleStartSetup}
              disabled={loading}
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Setup 2FA"}
            </Button>
          )}
        </div>

        <Dialog open={isSetupOpen} onOpenChange={setIsSetupOpen}>
          <DialogContent className="sm:max-w-md bg-zinc-950 border-zinc-800">
            <DialogHeader>
              <DialogTitle>Setup Authenticator</DialogTitle>
              <DialogDescription>
                Scan the QR code below with your preferred authenticator app.
              </DialogDescription>
            </DialogHeader>

            {setupData && (
              <div className="flex flex-col items-center space-y-6 py-4">
                <div className="p-4 bg-white rounded-xl">
                  <img src={setupData.qrCode} alt="MFA QR Code" className="w-48 h-48" />
                </div>
                
                <div className="w-full space-y-4">
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Verify Setup</p>
                    <Input
                      placeholder="6-digit code"
                      maxLength={6}
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                      className="h-11 text-center text-xl tracking-[0.5em] font-mono"
                    />
                  </div>
                  
                  <Button 
                    className="w-full h-11 premium-gradient-button"
                    onClick={handleVerifyAndEnable}
                    disabled={loading || verificationCode.length !== 6}
                  >
                    {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Verify and Enable"}
                  </Button>
                </div>

                <div className="w-full p-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-muted-foreground">
                  <p className="font-semibold text-zinc-300 mb-1">Manual Secret:</p>
                  <code className="select-all">{setupData.secret}</code>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <div className="text-xs text-muted-foreground flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <p>
            Important: If you lose access to your authenticator device, you will need your recovery key to access your account. Ensure your backup is secure before enabling.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
