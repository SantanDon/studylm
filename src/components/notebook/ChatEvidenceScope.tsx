import { formatDisplayTitle } from '@/lib/utils/displayTitle';

export type ChatEvidenceScopeValue = 'all' | 'active';

interface ChatEvidenceScopeProps {
  value: ChatEvidenceScopeValue;
  onChange: (value: ChatEvidenceScopeValue) => void;
  activeSourceTitle?: string | null;
  activeSourceUsable: boolean;
}

const ChatEvidenceScope = ({
  value,
  onChange,
  activeSourceTitle,
  activeSourceUsable,
}: ChatEvidenceScopeProps) => (
  <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground md:flex-none">
    <span className="shrink-0">Evidence</span>
    <select
      aria-label="Chat evidence scope"
      value={value}
      onChange={(event) => onChange(event.target.value as ChatEvidenceScopeValue)}
      className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground md:w-44 md:flex-none"
    >
      <option value="all">All ready sources</option>
      <option value="active" disabled={!activeSourceUsable}>
        {activeSourceUsable && activeSourceTitle
          ? `Current: ${formatDisplayTitle(activeSourceTitle, 'Current source')}`
          : 'Open a ready source first'}
      </option>
    </select>
  </label>
);

export default ChatEvidenceScope;
