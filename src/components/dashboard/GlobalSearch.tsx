import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiService } from '@/services/apiService';
import { useAuth } from '@/hooks/useAuth';
import { Search, FileText, Notebook, MessageSquare } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const GlobalSearch = ({ open, setOpen }: { open: boolean, setOpen: (v: boolean) => void }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any>(null);
  const [isSearching, setIsSearching] = useState(false);
  const { session } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (query.trim() && session?.access_token) {
        handleSearch();
      } else {
        setResults(null);
      }
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const handleSearch = async () => {
    setIsSearching(true);
    try {
      const data = await ApiService.globalSearch(query, session!.access_token);
      setResults(data);
    } catch (err) {
      console.error('Search error:', err);
    } finally {
      setIsSearching(false);
    }
  };

  const goToNotebook = (id: string) => {
    setOpen(false);
    navigate(`/notebook/${id}`);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl bg-white/80 backdrop-blur-xl border-gray-200/50 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center space-x-2 text-gray-800">
            <Search className="w-5 h-5 text-indigo-500" />
            <span>Global Pulse Search</span>
          </DialogTitle>
        </DialogHeader>
        
        <div className="mt-2">
          <Input 
            placeholder="Search across all notebooks, sources, and notes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-12 text-lg bg-gray-50/50 border-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            autoFocus
          />
        </div>

        <div className="mt-4 max-h-[400px] overflow-y-auto space-y-4">
          {isSearching && <div className="text-center py-8 text-gray-400">Scanning your intelligence...</div>}
          
          {results && (
            <>
              {results.notebooks?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notebooks</h3>
                  {results.notebooks.map((nb: any) => (
                    <div 
                      key={nb.id} 
                      onClick={() => goToNotebook(nb.id)}
                      className="flex items-center p-3 rounded-xl hover:bg-indigo-50 cursor-pointer transition-all border border-transparent hover:border-indigo-100"
                    >
                      <Notebook className="w-4 h-4 mr-3 text-indigo-400" />
                      <span className="text-gray-700 font-medium">{nb.title}</span>
                    </div>
                  ))}
                </div>
              )}

              {results.sources?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sources</h3>
                  {results.sources.map((s: any) => (
                    <div 
                      key={s.id} 
                      onClick={() => goToNotebook(s.notebookId)}
                      className="flex items-center p-3 rounded-xl hover:bg-emerald-50 cursor-pointer transition-all border border-transparent hover:border-emerald-100"
                    >
                      <FileText className="w-4 h-4 mr-3 text-emerald-400" />
                      <div>
                        <div className="text-gray-700 font-medium">{s.title}</div>
                        <div className="text-xs text-gray-400 truncate max-w-[500px]">{s.content?.substring(0, 100)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {results.notes?.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notes</h3>
                  {results.notes.map((n: any) => (
                    <div 
                      key={n.id} 
                      onClick={() => goToNotebook(n.notebookId)}
                      className="flex items-center p-3 rounded-xl hover:bg-amber-50 cursor-pointer transition-all border border-transparent hover:border-amber-100"
                    >
                      <MessageSquare className="w-4 h-4 mr-3 text-amber-400" />
                      <div className="text-gray-700 truncate max-w-[500px]">{n.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {query && !isSearching && results && (results.notebooks?.length + results.sources?.length + results.notes?.length) === 0 && (
            <div className="text-center py-8 text-gray-400">No matching intelligence found.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GlobalSearch;
