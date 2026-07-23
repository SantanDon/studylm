import React from 'react';
import { IMMERSIVE_PROMPTS } from '@/config/prompts';
import { ArrowUpRight } from 'lucide-react';

interface SovereignChatIntroProps {
  onPromptClick: (prompt: string) => void;
  username?: string;
}

const SovereignChatIntro: React.FC<SovereignChatIntroProps> = ({ onPromptClick, username }) => {
  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-4 pt-8 sm:px-8" aria-label="Suggested questions">
      <div className="mb-5">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Study chat</p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          {username ? `Where should we start, ${username}?` : 'Start with your sources'}
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Ask anything directly, or use one of these focused starting points.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {IMMERSIVE_PROMPTS.slice(0, 4).map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => onPromptClick(category.prompts[0])}
            className="group flex min-h-24 items-start gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-base" aria-hidden="true">
              {category.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-3 text-sm font-semibold text-foreground">
                {category.label}
                <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition group-hover:text-primary" />
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                {category.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
};

export default SovereignChatIntro;
