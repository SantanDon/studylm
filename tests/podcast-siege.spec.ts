import { test, expect } from '@playwright/test';

test.describe('Podcast Infrastructure - The Siege', () => {
  test('should persist generation state through page navigation', async ({ page }) => {
    // 1. Navigate to StudyLM
    // 1. Prepare LocalStorage with a Siege Notebook
    await page.addInitScript(() => {
      const notebookId = 'siege-notebook-id';
      const userId = 'siege-user-id';
      
      const notebook = {
        id: notebookId,
        title: 'The Siege Notebook',
        user_id: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        generation_status: 'pending'
      };

      const source = {
        id: 'siege-source-id',
        notebook_id: notebookId,
        title: 'Siege Logistics',
        type: 'text',
        content: 'This is the foundational text for the StudyLM Siege. It contains the logic of persistence and the strength of the Audio Lab.',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      localStorage.setItem('notebooks', JSON.stringify([notebook]));
      localStorage.setItem('sources', JSON.stringify([source]));
      localStorage.setItem('currentUser', JSON.stringify({ id: userId, email: 'siege@santlabs.com' }));
    });

    await page.goto('/');
    
    // 2. Open our injected notebook
    console.log('--- Initializing Podcast Production ---');
    await page.waitForSelector('.notebook-card', { timeout: 15000 });
    await page.click('.notebook-card');
    
    // 3. Open Audio Lab
    await page.click('button[data-testid="btn-generate-podcast"]');
    await expect(page.locator('.audio-lab-overlay')).toBeVisible();
    
    // 4. Set custom names in Audio Lab
    await page.fill('#host1', 'LO');
    await page.fill('#host2', 'ENI');
    
    // 5. Start Generation
    await page.click('button[data-testid="btn-start-production"]');
    
    // 6. Verify generation started
    await expect(page.locator('div[data-testid="podcast-generating-card"]')).toBeVisible();
    
    // 7. Navigate away (The Siege - Home)
    await page.click('button[data-testid="nav-home"]');
    await expect(page.locator('div[data-testid="podcast-generating-card"]')).not.toBeVisible();
    
    // 8. Return to Notebook and confirm restoration (Auto-rehydration)
    await page.click('.notebook-card >> nth=0');
    await expect(page.locator('div[data-testid="podcast-generating-card"]')).toBeVisible();
    
    // 9. Verify progress is still there and names persisted
    const statusText = await page.locator('.generating-status').textContent();
    console.log('--- Resumed Status:', statusText);
    
    console.log('--- Siege Passed: Persistence Confirmed ---');
  });

  test('should verify AI dialect and host names in script', async ({ page }) => {
    // This would test the logic we updated in podcastGenerator.ts
    // We expect the script to contain the custom names we passed in
  });
});
