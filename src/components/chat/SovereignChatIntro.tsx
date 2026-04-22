import React from 'react';
import { IMMERSIVE_PROMPTS } from '@/config/prompts';
import { Card } from '@/components/ui/card';

interface SovereignChatIntroProps {
  onPromptClick: (prompt: string) => void;
  username?: string;
}

const SovereignChatIntro: React.FC<SovereignChatIntroProps> = ({ onPromptClick, username }) => {
  return (
    <div className="max-w-4xl mx-auto py-12 px-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="text-center mb-12">
        <h2 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-4">
          Welcome to your Research Vault{username ? `, ${username}` : ''}
        </h2>
        <p className="text-muted-foreground text-lg max-w-2xl mx-auto leading-relaxed">
          The Council is standing by. Choose a specialist path or simply ask anything about your sources to begin the immersion.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {IMMERSIVE_PROMPTS.map((category) => (
          <Card key={category.id} className="group p-6 bg-background/50 backdrop-blur-xl border-border/50 hover:border-primary/50 hover:shadow-2xl hover:shadow-primary/5 transition-all duration-300 cursor-default">
            <div className="flex items-start space-x-4">
              <div className="text-3xl bg-primary/10 p-3 rounded-2xl group-hover:scale-110 transition-transform duration-300">
                {category.icon}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-bold text-foreground mb-1 group-hover:text-primary transition-colors">
                  {category.label}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {category.description}
                </p>
                <div className="space-y-2">
                  {category.prompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      onClick={() => onPromptClick(prompt)}
                      className="w-full text-left p-2.5 text-xs rounded-lg bg-muted/30 hover:bg-primary/10 hover:text-primary border border-transparent hover:border-primary/20 transition-all text-muted-foreground leading-snug"
                    >
                      "{prompt}"
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-12 text-center">
        <div className="inline-flex items-center space-x-2 px-4 py-2 bg-muted/30 rounded-full text-xs text-muted-foreground border border-border/50">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <span><b>Sovereign AI Active</b>: Groq-Titan 1.2 and Council Advising active</span>
        </div>
      </div>
    </div>
  );
};

export default SovereignChatIntro;
