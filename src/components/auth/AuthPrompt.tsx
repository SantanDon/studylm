import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useGuest } from '@/hooks/useGuest';
import { useNavigate } from 'react-router-dom';
import { Lock, BookOpen, MessageSquare, FileText, Headphones, Sparkles } from 'lucide-react';

export const AuthPromptModal = () => {
  const { authPromptOpen, authPromptFeature, closeAuthPrompt, remainingNotebooks } = useGuest();
  const navigate = useNavigate();

  const handleSignUp = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeAuthPrompt();
    navigate('/auth', { replace: true });
  };

  const handleSignIn = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    closeAuthPrompt();
    navigate('/auth', { replace: true });
  };

  const handleContinueAsGuest = () => {
    closeAuthPrompt();
  };

  const getFeatureIcon = () => {
    switch (authPromptFeature) {
      case 'create notebook':
        return <BookOpen className="h-12 w-12 text-blue-500" />;
      case 'add more sources':
        return <FileText className="h-12 w-12 text-green-500" />;
      case 'send more messages':
        return <MessageSquare className="h-12 w-12 text-purple-500" />;
      case 'generate podcast':
        return <Headphones className="h-12 w-12 text-orange-500" />;
      default:
        return <Sparkles className="h-12 w-12 text-yellow-500" />;
    }
  };

  return (
    <Dialog open={authPromptOpen} onOpenChange={closeAuthPrompt}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <div className="flex justify-center mb-4">
            {getFeatureIcon()}
          </div>
          <DialogTitle className="text-xl">
            You've reached your guest limit!
          </DialogTitle>
          <DialogDescription className="text-base mt-2">
            Sign up for free to {authPromptFeature} and unlock more features.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="bg-muted p-4 rounded-lg">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Guest Limits
            </h4>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• {remainingNotebooks} notebooks remaining</li>
              <li>• 5 sources per notebook</li>
              <li>• 20 messages per notebook</li>
              <li>• 1 podcast generation</li>
            </ul>
          </div>

          <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-900 mb-2">
              Free Account Benefits
            </h4>
            <ul className="text-sm space-y-1 text-blue-700">
              <li>✓ Unlimited notebooks</li>
              <li>✓ Unlimited sources</li>
              <li>✓ Unlimited messages</li>
              <li>✓ Unlimited podcasts</li>
              <li>✓ Flashcards & quizzes</li>
              <li>✓ Save progress across devices</li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button onClick={handleSignUp} className="w-full">
            Sign Up Free - Unlock Everything
          </Button>
          <Button variant="outline" onClick={handleSignIn} className="w-full">
            Sign In
          </Button>
          <Button variant="ghost" onClick={handleContinueAsGuest} className="w-full">
            Continue as Guest
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Guest mode indicator banner
export const GuestBanner = () => {
  const { isGuest, remainingNotebooks } = useGuest();
  const navigate = useNavigate();

  if (!isGuest) return null;

  const handleSignUpClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Sign up button clicked, navigating to /auth');
    navigate('/auth');
  };

  return (
    <div className="bg-muted border-b px-4 py-2">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="text-sm text-muted-foreground">
          Guest Mode — {remainingNotebooks} notebook{remainingNotebooks !== 1 ? 's' : ''} remaining
        </div>
        <Button 
          variant="link" 
          size="sm" 
          onClick={handleSignUpClick}
          className="text-primary hover:text-primary/80"
        >
          Sign up for free →
        </Button>
      </div>
    </div>
  );
};
