import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import apiService from '../services/apiService';
import { useAddSourcesHandlers } from '../components/notebook/hooks/useAddSourcesHandlers';

/**
 * A hook that checks for unencrypted raw files uploaded by CLI agents
 * into the Agent Dropbox, processes them locally (extracts text, generates embeddings),
 * encrypts them, syncs them to the backend, and then deletes the raw footprint.
 */
export const useAgentIngestion = (notebookId: string | undefined) => {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [isIngesting, setIsIngesting] = useState(false);
  const [ingestionStatus, setIngestionStatus] = useState<string | null>(null);

  // Hook into the main file upload pipeline, ignoring the UI modal states
  const { handleFileUpload } = useAddSourcesHandlers(notebookId, () => {}, false);

  useEffect(() => {
    if (!notebookId || !session?.access_token) return;

    const checkAndProcessPendingUploads = async () => {
      try {
        const { success, pendingUploads } = await apiService.getPendingAgentUploads(notebookId, session.access_token);
        
        if (success && pendingUploads && pendingUploads.length > 0) {
          console.log(`🤖 Agent Ingestion: Found ${pendingUploads.length} pending files.`);
          setIsIngesting(true);

          for (const upload of pendingUploads) {
            setIngestionStatus(`Processing agent file: ${upload.file_name}...`);
            try {
              // 1. Download the raw blob securely
              const fileBlob = await apiService.downloadAgentUpload(upload.id, session.access_token);
              
              // 2. Synthesize a File object for the document processor
              const syntheticFile = new File([fileBlob], upload.file_name, {
                type: upload.mime_type || 'application/octet-stream',
              });

              // 3. Process, encrypt, and push to E2EE Database natively
              await handleFileUpload([syntheticFile]);

              // 4. Delete the raw file from the backend agent dropbox
              await apiService.deleteAgentUpload(upload.id, session.access_token);
              console.log(`✅ Agent Ingestion: Successfully processed and secured ${upload.file_name}`);
            } catch (err) {
              console.error(`❌ Agent Ingestion: Failed to process ${upload.file_name}`, err);
            }
          }
          
          setIngestionStatus(null);
          
          // Force refresh sources list once all pending files are handled
          if (notebookId) {
            console.log("🤖 Agent Ingestion: All files processed, invalidating sources query...");
            queryClient.invalidateQueries({ queryKey: ["sources", notebookId] });
          }
        }
      } catch (err) {
        console.error("Error during agent ingestion polling:", err);
      } finally {
        setIsIngesting(false);
      }
    };

    // Run once on mount and every 30 seconds while the notebook is open
    checkAndProcessPendingUploads();
    const interval = setInterval(checkAndProcessPendingUploads, 30000);

    return () => clearInterval(interval);
  }, [notebookId, session, handleFileUpload]);

  return { isIngesting, ingestionStatus };
};
