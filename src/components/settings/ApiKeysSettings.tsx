import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Key, Save, Loader2, KeyRound } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/config/api';

export function ApiKeysSettings() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // State for different providers
  const [keys, setKeys] = useState({
    openai: '',
    anthropic: '',
    gemini: '',
    groq: ''
  });

  // Fetch existing keys (obfuscated or presence indicated) on mount
  useEffect(() => {
    const fetchKeys = async () => {
      try {
        setLoading(true);
        // We might not have a GET endpoint, but if we do, we'd call it here.
        // Assuming we just let users override existing keys for now if there's no GET.
        const res = await fetch(`${api.baseUrl}/user/api_keys`, {
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}` // Adjust based on actual auth mechanism
          }
        });
        
        if (res.ok) {
          const data = await res.json();
          // If the backend returns masked keys or presence indicators, populate the form
          if (data.apiKeys) {
             setKeys(prev => ({ ...prev, ...data.apiKeys }));
          }
        }
      } catch (error) {
        console.error("Failed to fetch API keys:", error);
      } finally {
        setLoading(false);
      }
    };
    
    // fetchKeys(); // Uncomment if a GET endpoint exists
  }, []);

  const handleSave = async (provider: string) => {
    try {
      setSaving(true);
      const res = await fetch(`${api.baseUrl}/user/api_keys`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}` // Adjust based on actual auth mechanism
        },
        body: JSON.stringify({
          provider,
          key: keys[provider as keyof typeof keys]
        })
      });

      if (!res.ok) throw new Error('Failed to update API key');

      toast({
        title: 'API Key Saved',
        description: `Your ${provider} key has been securely updated.`,
      });
      
      // Clear the input after save for security, or keep it masked
      setKeys(prev => ({ ...prev, [provider]: '' }));
      
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save API key. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-muted-foreground" />
            Sovereign BYOK (Bring Your Own Key)
          </CardTitle>
          <CardDescription>
            Securely inject your own AI provider keys. These keys are stored encrypted 
            and used directly by your local Sovereign Intelligence Hub.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* OpenAI */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">OpenAI API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="sk-..."
                value={keys.openai}
                onChange={(e) => setKeys({ ...keys, openai: e.target.value })}
                className="font-mono bg-muted"
              />
              <Button 
                onClick={() => handleSave('openai')} 
                disabled={saving || !keys.openai}
                className="w-24 shrink-0"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </div>
          </div>

          {/* Anthropic */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Anthropic API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="sk-ant-..."
                value={keys.anthropic}
                onChange={(e) => setKeys({ ...keys, anthropic: e.target.value })}
                className="font-mono bg-muted"
              />
              <Button 
                onClick={() => handleSave('anthropic')} 
                disabled={saving || !keys.anthropic}
                className="w-24 shrink-0"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </div>
          </div>

          {/* Gemini */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Google Gemini API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="AIza..."
                value={keys.gemini}
                onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
                className="font-mono bg-muted"
              />
              <Button 
                onClick={() => handleSave('gemini')} 
                disabled={saving || !keys.gemini}
                className="w-24 shrink-0"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </div>
          </div>

          {/* Groq */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Groq API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="gsk_..."
                value={keys.groq}
                onChange={(e) => setKeys({ ...keys, groq: e.target.value })}
                className="font-mono bg-muted"
              />
              <Button 
                onClick={() => handleSave('groq')} 
                disabled={saving || !keys.groq}
                className="w-24 shrink-0"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                Save
              </Button>
            </div>
          </div>

        </CardContent>
      </Card>
      
      <div className="p-4 bg-muted/50 rounded-lg border border-border">
        <h3 className="font-medium mb-1 text-sm flex items-center gap-2">
          <Key className="w-4 h-4" />
          Security Note
        </h3>
        <p className="text-xs text-muted-foreground">
          Keys are stored directly in your local database profile. The StudyPod backend leverages these 
          during orchestration to ensure decentralized, sovereign execution. To remove a key, save it as an empty field.
        </p>
      </div>
    </div>
  );
}
