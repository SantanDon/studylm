# Backend-Frontend Sync Issues

## Current Problem
The StudyPod frontend uses localStorage while the backend has a separate SQLite database. They never communicate.

## Issues

### 1. No API Integration in Frontend
- `src/hooks/useNotebooks.tsx` only calls `localNotebookStore.getNotebooks()`
- No fetch to `http://localhost:3001/api/notebooks`

### 2. No Sync Logic
- No mechanism to pull from backend on login
- No sync on app load
- LocalStorage is isolated from backend

### 3. Two Separate Data Stores
- Backend: SQLite database with user accounts
- Frontend: Browser localStorage
- They never communicate

### 4. Auth Token Not Used for API Calls
- User logs in but token isn't used to fetch notebooks from backend

### 5. Missing Features Needed
- `fetchNotebooksFromAPI(token)` function
- Sync on authentication success
- Merge local + cloud notebooks
- Handle offline mode

## Files to Modify

1. `src/hooks/useNotebooks.tsx` - Add API fetch logic
2. `src/services/apiService.ts` - Add fetchNotebooks method (already has partial implementation)
3. `src/hooks/useAuth.ts` - Trigger sync after login

## Solution Approach

1. After successful auth, fetch notebooks from backend API
2. Merge with local notebooks
3. Display combined list
4. Handle offline gracefully
