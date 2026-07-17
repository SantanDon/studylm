
import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
// import { Link } from 'lucide-react'; // Removed Lucide imports

interface MultipleWebsiteUrlsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (urls: string[]) => void;
}

const MultipleWebsiteUrlsDialog = ({
  open,
  onOpenChange,
  onSubmit
}: MultipleWebsiteUrlsDialogProps) => {
  const [urlsText, setUrlsText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    // Parse URLs from textarea - split by newlines and filter out empty lines
    const urls = urlsText
      .split('\n')
      .map(url => url.trim())
      .filter(url => url !== '');
    
    if (urls.length === 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(urls);
      setUrlsText('');
      onOpenChange(false);
    } catch (error) {
      console.error('Error submitting URLs:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setUrlsText('');
    onOpenChange(false);
  };

  // Count valid URLs for display
  const validUrls = urlsText
    .split('\n')
    .map(url => url.trim())
    .filter(url => url !== '');
  
  const isValid = validUrls.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2">
            <i className="fi fi-rr-link h-5 w-5 text-green-600"></i>
            <span>Add Multiple Website URLs</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-sm font-medium">Website URLs</Label>
            <p className="text-sm text-gray-600 mb-3">
              Enter multiple website URLs, one per line. Each URL will be scraped as a separate source.
            </p>
          </div>

          <div>
            <Textarea
              placeholder={`Enter URLs one per line, for example:
https://example.com
https://another-site.com
https://third-website.org`}
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              className="min-h-32 resize-y"
              rows={6}
            />
            {validUrls.length > 0 && (
              <p className="text-sm text-gray-500 mt-2">
                {validUrls.length} URL{validUrls.length !== 1 ? 's' : ''} detected
              </p>
            )}
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              disabled={!isValid || isSubmitting}
            >
              {isSubmitting ? 'Adding...' : `Add ${validUrls.length} Website${validUrls.length !== 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default MultipleWebsiteUrlsDialog;
