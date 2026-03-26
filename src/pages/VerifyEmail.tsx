import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { ApiService } from '@/services/apiService';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import Logo from '@/components/ui/Logo';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('No verification token provided.');
      return;
    }

    const verify = async () => {
      try {
        await ApiService.verifyEmail(token);
        setStatus('success');
      } catch (err: any) {
        setStatus('error');
        setErrorMessage(err.message || 'Verification failed. The link may be expired.');
      }
    };

    verify();
  }, [token]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-card border rounded-2xl shadow-sm text-center">
        <div className="flex justify-center mb-6">
          <Logo />
        </div>
        
        {status === 'verifying' && (
          <div className="space-y-4">
            <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin" />
            <h2 className="text-2xl font-bold">Verifying your email...</h2>
            <p className="text-muted-foreground">Please wait a moment.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="space-y-4 animate-in zoom-in duration-300">
            <div className="w-16 h-16 mx-auto bg-green-500/10 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
            <h2 className="text-2xl font-bold">Email Verified!</h2>
            <p className="text-muted-foreground">Your account is now fully active.</p>
            <div className="pt-4">
              <Button onClick={() => navigate('/auth')} className="w-full">
                Continue to Login
              </Button>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="space-y-4 animate-in zoom-in duration-300">
            <div className="w-16 h-16 mx-auto bg-red-500/10 rounded-full flex items-center justify-center">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-2xl font-bold">Verification Failed</h2>
            <p className="text-muted-foreground">{errorMessage}</p>
            <div className="pt-4 space-y-2">
              <Button onClick={() => navigate('/auth')} className="w-full" variant="outline">
                Back to Login
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
