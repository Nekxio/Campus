import { page as pageState, navigating as navigationState } from '$app/state';
import { toStore, type Readable } from 'svelte/store';

// Superforms 2 still subscribes to the removed $app/stores API. Read state lazily:
// SSR subscriptions must use the current component request, never a cached page.
function lazyStore<T>(read: () => T): Readable<T> {
	return {
		subscribe(run, invalidate) {
			return toStore(read).subscribe(run, invalidate);
		}
	};
}

// Snapshot each getter so client navigation changes notify store subscribers.
export const page = lazyStore(() => ({ ...pageState }));
export const navigating = lazyStore(() => (navigationState.to ? { ...navigationState } : null));
