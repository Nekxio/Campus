import { createContext } from 'svelte';

type WorkspaceNavigation = { sidebarOpen: boolean };

const [getNavigation, setNavigation] = createContext<WorkspaceNavigation>();

export const useWorkspaceNavigation = () => getNavigation();

export const initializeWorkspaceNavigation = () => {
	const navigation = $state<WorkspaceNavigation>({ sidebarOpen: true });
	return setNavigation(navigation);
};
