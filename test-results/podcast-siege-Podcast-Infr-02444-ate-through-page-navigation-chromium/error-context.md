# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: podcast-siege.spec.ts >> Podcast Infrastructure - The Siege >> should persist generation state through page navigation
- Location: tests\podcast-siege.spec.ts:4:3

# Error details

```
TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
Call log:
  - waiting for locator('.notebook-card') to be visible

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - region "Notifications (F8)":
    - list
  - generic [ref=e5]:
    - generic [ref=e6]: Guest Mode — 3 notebooks remaining
    - button "Sign up for free →" [ref=e7] [cursor=pointer]
  - generic [ref=e8]:
    - banner [ref=e9]:
      - generic [ref=e10]:
        - generic [ref=e11]:
          - img [ref=e13]
          - heading "StudyPodLM" [level=1] [ref=e15]:
            - generic [ref=e16]: StudyPodLM
        - button "G" [ref=e18] [cursor=pointer]:
          - generic [ref=e20]: G
    - main [ref=e21]:
      - heading "Welcome to StudyPodLM" [level=1] [ref=e23]:
        - generic [ref=e24]: Welcome to StudyPodLM
      - generic [ref=e25]:
        - generic [ref=e26]:
          - heading "Create your first notebook" [level=2] [ref=e27]
          - paragraph [ref=e28]: StudyPodLM is an AI-powered research and writing assistant that works best with the sources you upload
        - generic [ref=e29]:
          - generic [ref=e30]:
            - img [ref=e32]
            - heading "PDFs" [level=3] [ref=e35]
            - paragraph [ref=e36]: Upload research papers, reports, and documents
          - generic [ref=e37]:
            - img [ref=e39]
            - heading "Websites" [level=3] [ref=e42]
            - paragraph [ref=e43]: Add web pages and online articles as sources
          - generic [ref=e44]:
            - img [ref=e46]
            - heading "Audio" [level=3] [ref=e49]
            - paragraph [ref=e50]: Include multimedia content in your research
        - button "Create notebook" [ref=e51] [cursor=pointer]:
          - img
          - text: Create notebook
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Podcast Infrastructure - The Siege', () => {
  4  |   test('should persist generation state through page navigation', async ({ page }) => {
  5  |     // 1. Navigate to StudyLM
  6  |     // 1. Prepare LocalStorage with a Siege Notebook
  7  |     await page.addInitScript(() => {
  8  |       const notebookId = 'siege-notebook-id';
  9  |       const userId = 'siege-user-id';
  10 |       
  11 |       const notebook = {
  12 |         id: notebookId,
  13 |         title: 'The Siege Notebook',
  14 |         user_id: userId,
  15 |         created_at: new Date().toISOString(),
  16 |         updated_at: new Date().toISOString(),
  17 |         generation_status: 'pending'
  18 |       };
  19 | 
  20 |       const source = {
  21 |         id: 'siege-source-id',
  22 |         notebook_id: notebookId,
  23 |         title: 'Siege Logistics',
  24 |         type: 'text',
  25 |         content: 'This is the foundational text for the StudyLM Siege. It contains the logic of persistence and the strength of the Audio Lab.',
  26 |         created_at: new Date().toISOString(),
  27 |         updated_at: new Date().toISOString()
  28 |       };
  29 | 
  30 |       localStorage.setItem('notebooks', JSON.stringify([notebook]));
  31 |       localStorage.setItem('sources', JSON.stringify([source]));
  32 |       localStorage.setItem('currentUser', JSON.stringify({ id: userId, email: 'siege@santlabs.com' }));
  33 |     });
  34 | 
  35 |     await page.goto('/');
  36 |     
  37 |     // 2. Open our injected notebook
  38 |     console.log('--- Initializing Podcast Production ---');
> 39 |     await page.waitForSelector('.notebook-card', { timeout: 15000 });
     |                ^ TimeoutError: page.waitForSelector: Timeout 15000ms exceeded.
  40 |     await page.click('.notebook-card');
  41 |     
  42 |     // 3. Open Audio Lab
  43 |     await page.click('button[data-testid="btn-generate-podcast"]');
  44 |     await expect(page.locator('.audio-lab-overlay')).toBeVisible();
  45 |     
  46 |     // 4. Set custom names in Audio Lab
  47 |     await page.fill('#host1', 'LO');
  48 |     await page.fill('#host2', 'ENI');
  49 |     
  50 |     // 5. Start Generation
  51 |     await page.click('button[data-testid="btn-start-production"]');
  52 |     
  53 |     // 6. Verify generation started
  54 |     await expect(page.locator('div[data-testid="podcast-generating-card"]')).toBeVisible();
  55 |     
  56 |     // 7. Navigate away (The Siege - Home)
  57 |     await page.click('button[data-testid="nav-home"]');
  58 |     await expect(page.locator('div[data-testid="podcast-generating-card"]')).not.toBeVisible();
  59 |     
  60 |     // 8. Return to Notebook and confirm restoration (Auto-rehydration)
  61 |     await page.click('.notebook-card >> nth=0');
  62 |     await expect(page.locator('div[data-testid="podcast-generating-card"]')).toBeVisible();
  63 |     
  64 |     // 9. Verify progress is still there and names persisted
  65 |     const statusText = await page.locator('.generating-status').textContent();
  66 |     console.log('--- Resumed Status:', statusText);
  67 |     
  68 |     console.log('--- Siege Passed: Persistence Confirmed ---');
  69 |   });
  70 | 
  71 |   test('should verify AI dialect and host names in script', async ({ page }) => {
  72 |     // This would test the logic we updated in podcastGenerator.ts
  73 |     // We expect the script to contain the custom names we passed in
  74 |   });
  75 | });
  76 | 
```