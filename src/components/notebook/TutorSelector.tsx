import { TUTORS } from '@/config/tutors';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface TutorSelectorProps {
  selectedTutorId: string;
  onTutorSelect: (tutorId: string) => void;
  disabled?: boolean;
}

export const TutorSelector = ({
  selectedTutorId,
  onTutorSelect,
  disabled
}: TutorSelectorProps) => {
  return (
    <div className="flex items-center space-x-2 p-1.5 bg-muted/30 rounded-full border border-border mb-4 overflow-x-auto no-scrollbar max-w-full">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-3 mr-2 flex-shrink-0">
        Tutor
      </span>
      <TooltipProvider delayDuration={0}>
        <div className="flex items-center space-x-1">
          {TUTORS.map((tutor) => {
            const isSelected = selectedTutorId === tutor.id;
            
            return (
              <Tooltip key={tutor.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => onTutorSelect(tutor.id)}
                    disabled={disabled}
                    className={`relative h-8 px-3 rounded-full flex items-center space-x-2 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-all duration-300 ease-in-out transform hover:scale-105 active:scale-95 ${
                      isSelected 
                        ? 'text-primary-foreground font-medium bg-primary shadow-sm' 
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`}
                  >
                    <span className="relative z-10 flex items-center justify-center w-4 h-4">
                      {tutor.avatarIcon}
                    </span>
                    <span className="relative z-10 text-[11px] whitespace-nowrap">
                      {tutor.name}
                    </span>
                  </button>
                </TooltipTrigger>
                <TooltipContent 
                  side="bottom" 
                  className="bg-popover text-popover-foreground border-border shadow-lg rounded-lg p-3 max-w-[200px]"
                  sideOffset={8}
                >
                  <div className="flex flex-col gap-1">
                    <p className="font-bold text-xs flex items-center gap-2">
                       {tutor.avatarIcon}
                       {tutor.name}
                    </p>
                    <p className="text-[10px] text-muted-foreground leading-tight">{tutor.specialty}</p>
                    <div className="h-px bg-border/50 my-1" />
                    <p className="text-[10px] italic opacity-80">"{tutor.welcomeMessage}"</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
    </div>
  );
};
