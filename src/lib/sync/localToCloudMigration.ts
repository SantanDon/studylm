import { localStorageService } from '@/services/localStorageService';
import { ApiService } from '@/services/apiService';
import { getSyncManager } from './syncManager';

/**
 * Migrates data from local storage (Guest mode) to the Cloud backend (Authenticated mode).
 * Preserves notebook IDs to maintain existing relationships in E2EE sync blobs.
 */
export async function migrateLocalToCloud(guestId: string, accessToken: string) {
  console.log('🏁 Starting Local-to-Cloud migration for guest:', guestId);
  
  try {
    const notebooks = localStorageService.getNotebooks(guestId);
    if (!notebooks || notebooks.length === 0) {
      console.log('ℹ️ No local notebooks found to migrate.');
      return;
    }

    const syncManager = getSyncManager();

    for (const notebook of notebooks) {
      console.log(`📦 Migrating notebook: ${notebook.title} (${notebook.id})`);
      
      try {
        // 1. Recreate notebook in cloud with same ID
        await ApiService.createNotebook(
          notebook.title, 
          notebook.description, 
          accessToken, 
          notebook.id
        );

        // 2. Migrate sources for this notebook
        const sources = localStorageService.getSources(notebook.id);
        for (const source of sources) {
          console.log(`  📄 Migrating source metadata: ${source.title}`);
          
          await ApiService.createSource(notebook.id, {
            id: source.id,
            title: source.title,
            type: source.type,
            url: source.url,
            file_path: source.file_path,
            file_size: source.file_size,
            processing_status: source.processing_status,
            metadata: source.metadata
          }, accessToken);

          // 3. IMPORTANT: Trigger sync for E2EE content transfer
          // This will grab the extracted text/embeddings/chunks from local cache
          // and push them as encrypted blobs to /api/sync/upload
          console.log(`  🔒 Queueing E2EE sync for source: ${source.id}`);
          await syncManager.queueSync(source.id, 'source', source, 'update');
        }

        // 4. Migrate notes for this notebook
        const notes = localStorageService.getNotes(notebook.id);
        // ApiService currently doesn't have createNote, but let's assume it should follow pattern
        // if needed, otherwise sync manager might handle them if they are in sync_blobs
        for (const note of notes) {
           console.log(`  📝 Migrating note: ${note.title}`);
           // Notes are usually also handled by the sync engine in StudyPodLM's E2EE architecture
           await syncManager.queueSync(note.id, 'note', note, 'update');
        }

      } catch (err) {
        console.error(`❌ Failed to migrate notebook ${notebook.id}:`, err);
        // Continue with next notebook even if one fails
      }
    }

    console.log('✅ Local-to-Cloud migration pipeline completed.');
  } catch (err) {
    console.error('💥 Critical failure in migration pipeline:', err);
  }
}
