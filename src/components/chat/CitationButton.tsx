
import { Button } from '@/components/ui/button';

interface CitationButtonProps {
  chunkIndex: number;
  onClick: () => void;
  className?: string;
}

const CitationButton = ({ chunkIndex, onClick, className = '' }: CitationButtonProps) => {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className={`inline-flex items-center justify-center w-6 h-6 p-0 ml-1 text-xs font-medium text-blue-600 border-blue-300 hover:bg-blue-50 hover:border-blue-400 rounded-full ${className}`}
    >
      {chunkIndex + 1}
    </Button>
  );
};

export default CitationButton;
