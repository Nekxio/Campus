<script lang="ts">
	import {
		createModuleEditorSchema,
		friendlyModuleFields,
		moduleEditorFingerprint,
		savedModuleDates,
		toModuleDraft,
		toModuleEditorInput,
		type ModuleEditorInput
	} from './module-editor-input.js';
	import { cn } from '#lib/utils.js';
	import { currentAcademicYear } from '#lib/domain/academic-year.js';
	import SectionHeader from '#lib/components/shared/SectionHeader.svelte';
	import WorkSurface from '#lib/components/shared/WorkSurface.svelte';
	import ModuleTaskNavigation from './ModuleTaskNavigation.svelte';
	import ModulePageNavigation from './ModulePageNavigation.svelte';
	import ModuleInformation from './ModuleInformation.svelte';
	import ModulePreparation from './ModulePreparation.svelte';
	import ActionNotice from '#lib/components/ActionNotice.svelte';
	import { notify } from '#lib/client/notifications.js';
	import { tick, untrack } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import { defaults, setError, superForm, type FormPathLeavesWithErrors } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { beforeNavigate, goto, refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import { page } from '$app/state';
	import CircleAlertIcon from '@lucide/svelte/icons/circle-alert';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { moduleDraftSchema } from '#lib/domain/teaching.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import {
		captureModuleCreation,
		retainModuleCreation,
		reconcileContextRevisions,
		sameModuleDraft,
		validateModuleDetail,
		type ModuleCreationCommand
	} from '#lib/teaching/module-creation.js';
	import type { EditorData, ModuleDetail, ModuleDraft } from '#lib/teaching/types.js';
	import EditorFields from './EditorFields.svelte';
	import LinkEditor from './LinkEditor.svelte';
	import PlanningEditor from './PlanningEditor.svelte';
	import StudentContentEditor from './StudentContentEditor.svelte';

	let { data }: { data: EditorData } = $props();
	// Keyed by the parent; refreshing route data cannot overwrite an unsaved form.
	const initial = untrack(() => data.module);
	const originYear = untrack(() => {
		const year = page.url.searchParams.get('annee');
		return data.classes.some((item) => item.academicYear === year) ? year : null;
	});
	const originClassId = untrack(() => {
		if (initial) return '';
		const classId = page.url.searchParams.get('classe');
		const year = page.url.searchParams.get('annee');
		return data.classes.find((item) => item.id === classId && (!year || item.academicYear === year))?.id ?? '';
	});
	let fullEditor = $state(false);
	let optionalOpen = $state(false);
	let referencesOpen = $state(false);
	let moduleId = $state(initial?.id ?? null);
	let revision = $state(initial?.revision);
	// Saved instants are metadata, not a second editable calendar store.
	let savedDates = savedModuleDates(initial);
	const editorSchema = createModuleEditorSchema(() => savedDates);
	const form = superForm<ModuleEditorInput, string>(
		defaults<ModuleEditorInput, string>(toModuleEditorInput(initial, originClassId), zod4(editorSchema)),
		{
			id: 'module-draft',
			dataType: 'json',
			validators: zod4Client(editorSchema),
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false,
			validationMethod: 'submit-only',
			scrollToError: 'off',
			autoFocusOnError: false
		}
	);
	const actionTransport = createFormActionTransport(form);
	const actionPath = $derived(
		moduleId
			? resolve('/enseignant/modules/[moduleId]', { moduleId }) + '?/saveModule'
			: resolve('/enseignant/modules/nouveau') + '?/createModule'
	);
	const { form: formData, errors, allErrors } = form;
	let persistedIds = $state(initial?.contexts.map((context) => context.id) ?? []);
	let persistedLessonIds = $state(
		initial?.contexts.flatMap((context) => context.lessons.map((lesson) => lesson.id)) ?? []
	);
	const sectionUrl = $derived(page.shallow?.url ?? page.url);
	const section = $derived(
		['information', 'preparation', 'resources', 'planning'].includes(sectionUrl.searchParams.get('section') ?? '')
			? sectionUrl.searchParams.get('section')!
			: 'information'
	);
	$effect(() => {
		if (section !== 'planning' || sectionUrl.hash !== '#module-add-class') return;
		let cancelled = false;
		void tick().then(() => {
			if (!cancelled) document.getElementById('module-add-class')?.focus();
		});
		return () => {
			cancelled = true;
		};
	});
	let pending = $state(false);
	let errorMessage = $state('');
	let errorTitle = $state('Enregistrement non confirmé');
	let conflict = $state(false);
	let status = $state(untrack(() => (initial && page.state.createdModuleId === initial.id ? 'Brouillon créé.' : '')));
	let statusKind = $state<'success' | 'warning'>('success');
	let creationConfirmed = $state(false);
	let saveUnconfirmed = $state(false);
	let summary = $state<HTMLDivElement | null>(null);
	let confirmOpen = $state(false);
	let confirmKind = $state<'leave' | 'reload'>('leave');
	let destination = $state<ResolvedPathname>(resolve('/'));
	let allowNavigation = false;
	let creationCommand: ModuleCreationCommand | undefined;
	let baseline = $state(untrack(() => moduleEditorFingerprint($formData)));
	const dirty = $derived(moduleEditorFingerprint($formData) !== baseline);
	const canSave = $derived(!pending && (moduleId === null || dirty || saveUnconfirmed));
	const privateReferenceCount = $derived(
		Number(Boolean($formData.sourcePath.trim())) + $formData.preparation.sourceLinks.length
	);
	const errorEntries = $derived($allErrors.map(({ path, messages }) => [path, messages[0]] as const));
	const openedClass = $derived(
		data.classes.find((item) =>
			$formData.contexts.some(
				(context) =>
					context.classId === item.id &&
					(item.id === sectionUrl.searchParams.get('classe') ||
						(!sectionUrl.searchParams.has('classe') && context.id === sectionUrl.searchParams.get('contexte')))
			)
		)
	);
	const creationClass = $derived(!moduleId ? data.classes.find((item) => item.id === $formData.addClassId) : undefined);
	const completeEditor = $derived(Boolean(moduleId || fullEditor || section !== 'information'));
	const openFullEditor = async () => {
		fullEditor = true;
		await tick();
		document.getElementById('module-title')?.focus();
	};
	const openedContext = $derived(
		$formData.contexts.find((context) => persistedIds.includes(context.id) && context.classId === openedClass?.id)
	);
	const navigationScope = $derived.by((): Record<string, string> =>
		openedContext ? { classe: openedContext.classId, contexte: openedContext.id } : {}
	);
	const rubricQuery = $derived(new URLSearchParams({ ...navigationScope, section, retour: 'module' }).toString());
	const sections = [
		{ value: 'information', label: 'Informations' },
		{ value: 'preparation', label: 'Notes privées' },
		{ value: 'resources', label: 'Contenu étudiant' },
		{ value: 'planning', label: 'Classe et planning' }
	];
	const selectSection = async (value: string) => {
		if (value === section || !sections.some((item) => item.value === value)) return;
		const destination = new URL(sectionUrl.href);
		destination.searchParams.set('section', value);
		const path = `${destination.pathname}${destination.search}${destination.hash}` as ResolvedPathname;
		await goto(path, { shallow: true, reset: false, state: page.state });
	};

	function applySaved(value: ModuleDetail) {
		creationConfirmed = false;
		saveUnconfirmed = false;
		moduleId = value.id;
		revision = value.revision;
		savedDates = savedModuleDates(value);
		form.reset({ data: toModuleEditorInput(value), newState: toModuleEditorInput(value) });
		persistedIds = value.contexts.map((context) => context.id);
		persistedLessonIds = value.contexts.flatMap((context) => context.lessons.map((lesson) => lesson.id));
		conflict = false;
		errorMessage = '';
		baseline = moduleEditorFingerprint($formData);
	}
	function sectionFor(path: string) {
		if (path.startsWith('contexts') || path === 'addClassId') return 'planning';
		if (path.startsWith('resources') || path.startsWith('studentContent')) return 'resources';
		if (path.startsWith('preparation') || path === 'sourcePath') return 'preparation';
		return 'information';
	}
	function fieldLabel(path: string) {
		const parts = path
			.replace(/\[(\d+)\]/g, '.$1')
			.split('.')
			.filter((part) => part !== '_errors');
		const labels: Record<string, string> = {
			title: 'Nom du module',
			description: 'Description',
			objectives: 'Objectifs pédagogiques',
			sourcePath: 'Dossier source local',
			framing: 'Cadrage pédagogique',
			nextSteps: 'Prochaines étapes',
			label: 'Intitulé',
			url: 'Lien HTTPS',
			kind: 'Type de support',
			contexts: 'Classe et planning',
			resources: 'Supports et liens',
			sourceLinks: 'Références privées',
			startsAt: 'Début de la séance',
			endsAt: 'Fin de la séance',
			recap: 'Récapitulatif',
			toDo: 'À faire',
			classId: 'Classe associée',
			lessons: 'Séances',
			expectedRevision: 'Version du module',
			addClassId: 'Classe à associer'
		};
		if (parts[0] === 'objectives') return labels.objectives;
		if (parts[0] === 'resources' && parts[1])
			return `Support ${Number(parts[1]) + 1} · ${labels[parts.at(-1) ?? ''] ?? 'Lien'}`;
		if (parts[1] === 'sourceLinks' && parts[2])
			return `Référence ${Number(parts[2]) + 1} · ${labels[parts.at(-1) ?? ''] ?? 'Lien'}`;
		if (parts[0] === 'contexts' && parts[1]) {
			const context = $formData.contexts[Number(parts[1])];
			const item = data.classes.find((value) => value.id === context?.classId);
			const label = parts[2] === 'lessons' && parts[3] ? `Séance ${Number(parts[3]) + 1} · ` : '';
			return `${item?.name ?? 'Classe'} · ${label}${parts.at(-1) === 'title' ? 'Intitulé' : (labels[parts.at(-1) ?? ''] ?? 'Planning')}`;
		}
		return labels[parts.at(-1) ?? ''] ?? 'Module';
	}
	function applyRequestErrors(fields: Record<string, string>) {
		const snapshot = form.capture();
		for (const [rawPath, message] of Object.entries(friendlyModuleFields(fields))) {
			let path = rawPath.startsWith('objectives') ? 'objectives' : rawPath.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
			if (/^(resources|contexts|preparation\.sourceLinks)$/.test(path) || path.endsWith('.lessons')) path += '._errors';
			if (!/^(title|description|objectives|sourcePath|preparation|resources|contexts|addClassId)(\.|\[|$)/.test(path))
				path = '';
			setError(snapshot, path as FormPathLeavesWithErrors<ModuleEditorInput> | '', message, {
				overwrite: true
			});
		}
		errors.set(snapshot.errors);
	}
	const revealErrorSection = async (path: string) => {
		if (path === 'description' || path.startsWith('objectives')) optionalOpen = true;
		if (path === 'sourcePath' || path.startsWith('preparation.sourceLinks')) referencesOpen = true;
		await selectSection(sectionFor(path));
	};
	async function focusErrors() {
		notify(errorMessage || 'Vérifiez les champs indiqués. Vos saisies sont conservées.', 'error');
		if ($allErrors[0]) await revealErrorSection($allErrors[0].path);
		await tick();
		summary?.focus();
	}
	async function jumpToError(path: string) {
		await revealErrorSection(path);
		await tick();
		const name = path.replace(/\.(\d+)/g, '[$1]').replace(/\._errors$/, '');
		const fields = [...document.querySelectorAll<HTMLElement>('#module-form [name]')];
		const target =
			fields.find((field) => field.getAttribute('name') === name) ??
			fields.find(
				(field) =>
					field.getAttribute('name')?.startsWith(`${name}.`) || field.getAttribute('name')?.startsWith(`${name}[`)
			);
		if (target) target.focus();
		else summary?.focus();
	}
	async function readSavedModule(id: string) {
		const response = await fetch(`/api/teaching/modules/${id}`, { credentials: 'same-origin' });
		if (!response.ok)
			throw new TeachingRequestError(
				response.status,
				'Actualisation impossible. Vos saisies et la tentative de création sont conservées ; réessayez.'
			);
		return validateModuleDetail(await response.json(), id);
	}
	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!canSave) return;
		pending = true;
		errorMessage = '';
		errorTitle = 'Enregistrement non confirmé';
		status = '';
		statusKind = 'success';
		creationConfirmed = false;
		let updateAttempted = false;
		try {
			// The main save also commits the pending class selection, without requiring
			// the intermediate add action. Keep its ID in the draft for retries/errors.
			if ($formData.addClassId && $formData.contexts.length === 0) {
				const classId = $formData.addClassId;
				if (!data.classes.some((item) => item.id === classId)) {
					applyRequestErrors({ addClassId: 'Choisissez une classe disponible.' });
					errorMessage = 'Vérifiez la classe choisie. Vos saisies sont conservées.';
					await focusErrors();
					return;
				}
				$formData = {
					...$formData,
					addClassId: '',
					contexts: [{ id: crypto.randomUUID(), classId, lessons: [] }]
				};
			}
			const creating = moduleId === null;
			let command = creating ? creationCommand : undefined;
			let payload: ModuleDraft;
			if (command) payload = command.payload;
			else {
				const validated = await form.validateForm({ update: true, focusOnError: false });
				if (!validated.valid) {
					errorMessage = 'Vérifiez les champs indiqués. Vos saisies sont conservées.';
					await focusErrors();
					return;
				}
				payload = moduleDraftSchema.parse(toModuleDraft(validated.data, savedDates));
				if (creating) command = creationCommand = captureModuleCreation(crypto.randomUUID(), payload);
			}
			const requestedId = command?.id ?? moduleId;
			if (!requestedId) throw new Error('Missing module identity.');
			const decode = (value: unknown) => validateModuleDetail(value, requestedId);
			updateAttempted = !creating;
			const saved = creating
				? await actionTransport.submit(actionPath, { id: requestedId, draft: payload }, decode)
				: await actionTransport.submit(actionPath, { ...payload, expectedRevision: revision }, decode);
			if (command && !sameModuleDraft(toModuleDraft($formData, savedDates), command.payload)) {
				const contexts = reconcileContextRevisions($formData.contexts, saved);
				moduleId = saved.id;
				revision = saved.revision;
				savedDates = savedModuleDates(saved);
				persistedIds = saved.contexts.map((context) => context.id);
				persistedLessonIds = saved.contexts.flatMap((context) => context.lessons.map((lesson) => lesson.id));
				baseline = moduleEditorFingerprint(toModuleEditorInput(saved));
				$formData = { ...$formData, contexts };
				creationCommand = undefined;
				conflict = false;
				errors.set({});
				creationConfirmed = true;
				status = 'Brouillon créé.';
				return;
			}
			applySaved(saved);
			creationCommand = undefined;
			status = creating ? '' : 'Module enregistré.';
			if (creating) {
				try {
					allowNavigation = true;
					const createdContext = saved.contexts[0];
					const query = new SvelteURLSearchParams();
					if (createdContext) {
						query.set('classe', createdContext.classId);
						query.set('contexte', createdContext.id);
					}
					const year = data.classes.find((item) => item.id === createdContext?.classId)?.academicYear ?? originYear;
					if (year) query.set('annee', year);
					const createdDestination = (resolve('/enseignant/modules/[moduleId]', {
						moduleId: saved.id
					}) + (query.size ? '?' + query : '')) as ResolvedPathname;
					await goto(createdDestination, { state: { ...page.state, createdModuleId: saved.id } });
				} catch {
					statusKind = 'warning';
					status = 'Brouillon créé. Vous pouvez continuer à le modifier ici.';
				} finally {
					allowNavigation = false;
				}
			} else {
				try {
					await refreshAll();
				} catch {
					statusKind = 'warning';
					status = 'Module enregistré. L’actualisation de la page est indisponible.';
				}
			}
		} catch (error) {
			if (
				updateAttempted &&
				(!(error instanceof TeachingRequestError) || !error.decodedServerError || error.status >= 500)
			)
				saveUnconfirmed = true;
			if (!retainModuleCreation(error)) creationCommand = undefined;
			if (error instanceof TeachingRequestError) {
				conflict = error.status === 409;
				if (conflict && creationCommand) {
					try {
						// Confirm identity only. A newer revision requires the explicit discard decision.
						await readSavedModule(creationCommand.id);
					} catch {
						errorMessage =
							'Actualisation impossible. Vos saisies et la tentative de création sont conservées ; réessayez.';
						await focusErrors();
						return;
					}
				}
				applyRequestErrors(
					Object.fromEntries(Object.entries(error.fields).map(([path, text]) => [path.replace(/^draft\./, ''), text]))
				);
				errorMessage = conflict
					? 'Le module ou son planning a changé depuis son ouverture. Vos saisies sont conservées. Rechargez la version actuelle avant de reprendre les modifications.'
					: error.message;
			} else errorMessage = 'Enregistrement impossible. Vos saisies sont conservées ; réessayez.';
			await focusErrors();
		} finally {
			pending = false;
		}
	}
	beforeNavigate((navigation) => {
		if (navigation.shallow && navigation.to?.url.pathname === page.url.pathname) return;
		if (allowNavigation || (!dirty && !pending && !creationCommand && !saveUnconfirmed)) return;
		navigation.cancel();
		if (navigation.willUnload) return;
		if (navigation.to) {
			destination = (navigation.to.url.pathname +
				navigation.to.url.search +
				navigation.to.url.hash) as ResolvedPathname;
			confirmKind = 'leave';
			confirmOpen = true;
		}
	});
	function requestReload() {
		confirmKind = 'reload';
		confirmOpen = true;
	}
	async function confirmDiscard() {
		if (pending) return;
		confirmOpen = false;
		if (confirmKind === 'reload') {
			pending = true;
			try {
				const id = creationCommand?.id ?? moduleId;
				if (!id) throw new Error('No saved module identity.');
				applySaved(await readSavedModule(id));
				creationCommand = undefined;
				status = 'Version actuelle rechargée.';
			} catch {
				errorTitle = 'Actualisation impossible';
				errorMessage = 'Actualisation impossible. Vos saisies sont conservées ; réessayez.';
				await focusErrors();
			} finally {
				pending = false;
			}
			return;
		}
		allowNavigation = true;
		try {
			await goto(destination);
		} catch {
			errorTitle = 'Navigation impossible';
			errorMessage = 'Impossible d’ouvrir cette page. Vos saisies sont conservées.';
			await focusErrors();
		} finally {
			allowNavigation = false;
		}
	}
	async function cancelEditing() {
		try {
			await goto(
				openedClass
					? openedClass.academicYear === currentAcademicYear()
						? resolve(`/enseignant/classes?classe=${openedClass.id}`)
						: resolve(`/enseignant/classes/annees?annee=${openedClass.academicYear}`)
					: resolve('/enseignant/modules')
			);
		} catch {
			if (!confirmOpen) {
				errorTitle = 'Navigation impossible';
				errorMessage = 'Impossible d’ouvrir l’accueil. Vos saisies sont conservées.';
				await focusErrors();
			}
		}
	}

	let saveBar = $state<HTMLDivElement | null>(null);

	function retainActionPointer(event: PointerEvent) {
		const target = event.currentTarget;
		if (
			!(target instanceof HTMLElement) ||
			!target.matches('button, summary') ||
			!event.isPrimary ||
			event.button !== 0
		)
			return;
		const bounds = target.getBoundingClientRect();
		// Blur validation can move a control between press and release. Keep the intended click target,
		// but preserve drag-out cancellation rather than firing an action on pointerdown.
		target.setPointerCapture(event.pointerId);
		const releaseOutside = (move: PointerEvent) => {
			if (
				move.pointerId === event.pointerId &&
				(move.clientX < bounds.left ||
					move.clientX > bounds.right ||
					move.clientY < bounds.top ||
					move.clientY > bounds.bottom)
			)
				target.releasePointerCapture(event.pointerId);
		};
		target.addEventListener('pointermove', releaseOutside);
		target.addEventListener(
			'lostpointercapture',
			() => {
				target.removeEventListener('pointermove', releaseOutside);
			},
			{ once: true }
		);
	}

	const revealFocusedField = async (target: EventTarget | null) => {
		if (
			!(target instanceof HTMLElement) ||
			!target.matches('input, textarea, select') ||
			!target.closest('#module-form')
		)
			return;
		await tick();
		if (document.activeElement !== target || !saveBar || getComputedStyle(saveBar).position !== 'sticky') return;
		const descriptions = (target.getAttribute('aria-describedby') ?? '')
			.split(' ')
			.map((id) => document.getElementById(id))
			.filter((node): node is HTMLElement => Boolean(node && node.getBoundingClientRect().height > 0));
		const bottom = Math.max(
			target.getBoundingClientRect().bottom,
			...descriptions.map((node) => node.getBoundingClientRect().bottom)
		);
		const covered = bottom - saveBar.getBoundingClientRect().top;
		if (covered > 0) window.scrollBy({ top: covered + 16, behavior: 'instant' });
	};
</script>

<svelte:window onresize={() => revealFocusedField(document.activeElement)} />

{#snippet moduleName()}
	<EditorFields id="module-title" label="Nom du module" {form} name="title" required maxlength={200} />
{/snippet}
{#snippet optionalInformation(compact: boolean)}
	<EditorFields
		id="module-description"
		label="Description"
		multiline
		{compact}
		{form}
		name="description"
		required={false}
		maxlength={20000}
	/>
	<EditorFields
		id="module-objectives"
		label="Objectifs pédagogiques"
		multiline
		{compact}
		{form}
		name="objectives"
		required={false}
		description="Un objectif par ligne."
	/>
{/snippet}

{#snippet saveButton()}
	<Button type="submit" form="module-form" disabled={!canSave} onpointerdown={retainActionPointer}
		>{#if pending}<Spinner data-icon="inline-start" aria-hidden="true" />{/if}{pending
			? 'Enregistrement…'
			: moduleId
				? 'Enregistrer le module'
				: 'Créer le brouillon'}</Button
	>
{/snippet}

{#snippet editorActions()}
	<div class={cn('editor-save-bar', !completeEditor && 'short-save-bar')} bind:this={saveBar}>
		<div role="status" aria-live="polite" class="min-h-5 text-sm text-muted-foreground">
			{pending
				? 'Enregistrement du module en cours…'
				: saveUnconfirmed
					? 'Enregistrement non confirmé. Vos saisies sont conservées.'
					: dirty
						? creationConfirmed
							? 'Brouillon créé. Vos modifications actuelles restent à enregistrer.'
							: 'Modifications non enregistrées.'
						: moduleId
							? 'Toutes les modifications sont enregistrées.'
							: 'Le brouillon n’est pas encore créé.'}
		</div>
		<div class="flex flex-wrap items-center gap-3">
			<Button
				type="button"
				variant="outline"
				class="min-h-11"
				disabled={pending}
				onpointerdown={retainActionPointer}
				onclick={cancelEditing}>Annuler</Button
			>
			{@render saveButton()}
		</div>
	</div>
{/snippet}

<ActionNotice message={status} kind={statusKind} />

<div class="module-editor page-sections">
	{#if data.module?.needsReview}<Alert.Root role="region" aria-label="Brouillon à relire">
			<CircleAlertIcon aria-hidden="true" /><Alert.Title>Brouillon à relire avant publication</Alert.Title>
			<Alert.Description
				><ul>
					{#each data.module.agentChanges ?? [] as change, index (index)}<li>{change}</li>{/each}
				</ul>
				La page publique conserve sa dernière version jusqu’à votre décision dans Publication.</Alert.Description
			>
		</Alert.Root>{/if}
	{#snippet moduleHeading()}
		<div class="module-heading section-header" data-persisted={Boolean(moduleId)}>
			<div class="flex min-w-0 flex-col gap-label">
				<h1 class="min-w-0 page-title">
					{moduleId ? $formData.title || initial?.title : 'Créer un module'}
				</h1>
				<p class="min-w-0 text-sm text-muted-foreground">
					{#if openedClass || creationClass}{@const schoolClass = openedClass ?? creationClass!}
						{schoolClass.name}{#if schoolClass.academicYear !== currentAcademicYear()}
							· {schoolClass.academicYear}{/if}<span aria-hidden="true"> · </span>
					{/if}
					{moduleId ? 'Préparation privée' : 'Nouveau brouillon'}
				</p>
				{#if !moduleId}<p class="text-sm text-muted-foreground">
						Donnez un nom au module pour créer le brouillon.
					</p>{/if}
			</div>
			<div class="section-actions">
				{#if moduleId && data.publishedPath}
					<Button
						variant="outline"
						href={data.publishedPath as ResolvedPathname}
						target="_blank"
						rel="noopener noreferrer"
						disabled={pending}
					>
						<ExternalLinkIcon data-icon="inline-start" aria-hidden="true" />Voir la page publiée
						<span class="sr-only"> · nouvel onglet</span>
					</Button>
				{/if}
				{#if completeEditor}{@render saveButton()}{/if}
			</div>
		</div>
	{/snippet}
	{#if moduleId}
		<ModulePageNavigation
			{moduleId}
			moduleTitle={$formData.title || initial?.title || 'Module'}
			currentPage="module"
			classId={openedContext?.classId}
			contextId={openedContext?.id}
			academicYear={openedClass?.academicYear}
			returnSection={section}
			disabled={pending}
		>
			{@render moduleHeading()}
		</ModulePageNavigation>
	{:else}
		{@render moduleHeading()}
	{/if}
	{#if status && statusKind === 'warning'}
		<Alert.Root>
			<CircleAlertIcon aria-hidden="true" />
			<Alert.Title>Enregistrement confirmé</Alert.Title>
			<Alert.Description>{status}</Alert.Description>
		</Alert.Root>
	{/if}
	{#if errorMessage || errorEntries.length > 0}
		<Alert.Root
			variant="destructive"
			bind:ref={summary}
			role={errorEntries.length ? 'group' : 'alert'}
			aria-labelledby="module-feedback-title"
			tabindex={-1}
			class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		>
			<CircleAlertIcon aria-hidden="true" />
			<Alert.Title id="module-feedback-title"
				>{conflict
					? 'Version à actualiser'
					: errorEntries.length > 0
						? 'Des champs nécessitent votre attention'
						: errorTitle}</Alert.Title
			>
			<Alert.Description>
				<div class="flex flex-col gap-3">
					{#if errorMessage}<p>{errorMessage}</p>{/if}
					{#if errorEntries.length > 0}
						<ul class="flex flex-col gap-1">
							{#each errorEntries as [path, message] (path)}<li>
									<Button
										type="button"
										variant="link"
										class="min-h-11 max-w-full justify-start px-0 text-left whitespace-normal"
										onclick={() => jumpToError(path)}>{fieldLabel(path)} · {message}</Button
									>
								</li>{/each}
						</ul>
					{/if}
					{#if conflict}<Button
							type="button"
							variant="outline"
							class="min-h-11 self-start"
							disabled={pending}
							onclick={requestReload}>Recharger la version actuelle</Button
						>{/if}
				</div>
			</Alert.Description>
		</Alert.Root>
	{/if}
	<form
		id="module-form"
		method="POST"
		action={actionPath}
		use:actionTransport.enhance
		class="editor-content"
		novalidate
		onsubmit={actionTransport.handleSubmit(save)}
		onfocusin={(event) => revealFocusedField(event.target)}
		aria-busy={pending}
	>
		<fieldset disabled={pending} class="min-w-0">
			{#if !completeEditor}
				<div class="short-creation">
					<WorkSurface element="div" class="flex min-w-0 flex-col gap-6">
						{@render moduleName()}
						{@render editorActions()}
						<details bind:open={optionalOpen} class="group min-w-0">
							<summary
								class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							>
								<span>Informations facultatives</span>
								<ChevronDownIcon
									class="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none"
									aria-hidden="true"
								/>
							</summary>
							<Field.FieldGroup class="mt-4 gap-6">{@render optionalInformation(true)}</Field.FieldGroup>
						</details>
						<Button
							type="button"
							variant="link"
							class="min-h-11 self-start px-0 whitespace-normal"
							onclick={openFullEditor}>Ouvrir l’éditeur complet</Button
						>
					</WorkSurface>
					<aside class="creation-guide">
						<h2>Après la création</h2>
						<p>Préparez le contenu, associez une classe et définissez les évaluations quand vous en avez besoin.</p>
						<p>La publication reste une décision séparée, après votre vérification.</p>
					</aside>
				</div>
			{:else}
				<Tabs.Root orientation="vertical" value={section} onValueChange={selectSection} class="module-layout">
					<ModuleTaskNavigation {section} {sections} onSelect={selectSection} />
					<WorkSurface element="div">
						<Tabs.Content value="information" class="min-w-0"
							><ModuleInformation {moduleId} {moduleName} {optionalInformation} /></Tabs.Content
						>
						<Tabs.Content value="preparation" class="min-w-0"
							><ModulePreparation
								{form}
								bind:referencesOpen
								{privateReferenceCount}
								{retainActionPointer}
							/></Tabs.Content
						>
						<Tabs.Content value="resources" class="min-w-0">
							<SectionHeader
								title="Contenu étudiant"
								description="Préparez les supports, les consignes et les exercices destinés aux étudiants. Ces contenus apparaissent sur leur page uniquement après votre publication ou sa mise à jour."
							/>
							<div class="mt-6">
								<LinkEditor {form} student />
								<div class="mt-8"><StudentContentEditor {form} /></div>
							</div>
						</Tabs.Content>
						<Tabs.Content value="planning" class="min-w-0">
							<SectionHeader title="Classe et planning" description="Organisez les séances de la classe associée." />
							<div class="mt-6">
								{#if moduleId}<Button
										class="mb-6"
										variant="outline"
										disabled={pending}
										href={`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId })}?${rubricQuery}#echeances${openedContext ? '-' + openedContext.id : ''}`}
										>Régler les échéances des évaluations</Button
									>{/if}
								<PlanningEditor
									{form}
									disabled={pending}
									classes={data.classes}
									{persistedIds}
									{persistedLessonIds}
									managedLessons={data.managedLessons}
								/>
							</div>
						</Tabs.Content>
					</WorkSurface>
				</Tabs.Root>
			{/if}
		</fieldset>
	</form>
	{#if completeEditor}{@render editorActions()}{/if}
</div>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
		<AlertDialog.Header>
			<AlertDialog.Title>{confirmKind === 'reload' ? 'Recharger le module ?' : 'Quitter le module ?'}</AlertDialog.Title
			>
			<AlertDialog.Description
				>{confirmKind === 'reload'
					? 'La version enregistrée remplacera vos saisies actuelles. Les modifications non enregistrées seront perdues.'
					: 'Vos modifications ne sont pas enregistrées. En quittant cette page, vous les perdrez.'}</AlertDialog.Description
			>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class="min-h-11">Continuer à modifier</AlertDialog.Cancel>
			<AlertDialog.Action class="min-h-11" disabled={pending} onclick={confirmDiscard}
				>{confirmKind === 'reload' ? 'Recharger et remplacer' : 'Quitter sans enregistrer'}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	.short-creation {
		display: grid;
		gap: 2rem;
	}
	.short-save-bar {
		position: static;
		align-items: flex-start;
		gap: 0.75rem;
		border: 0;
		padding: 0;
		background: transparent;
	}
	.short-save-bar > [role='status'] {
		order: 1;
		width: 100%;
	}
	.creation-guide {
		padding-block: 1rem;
		max-width: 38rem;
	}
	.creation-guide h2 {
		font-size: 1rem;
		font-weight: 600;
	}
	.creation-guide p {
		margin-top: 1rem;
		color: var(--muted-foreground);
		font-size: 0.875rem;
		line-height: 1.7;
	}
	@media (min-width: 64rem) {
		.short-creation {
			grid-template-columns: minmax(0, 1.5fr) minmax(14rem, 1fr);
			gap: 3rem;
			align-items: start;
		}
	}

	.module-heading {
		padding-block-end: 1.5rem;
		border-block-end: 1px solid var(--border);
	}
	.module-heading[data-persisted='true'] {
		padding-block-end: 0;
		border-block-end: 0;
	}
	.editor-content {
		min-width: 0;
	}
	.module-editor :global(.module-layout) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
	}
	.module-editor :global([data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	@media (min-width: 64rem) {
		.module-editor :global(.module-layout) {
			grid-template-columns: 13rem minmax(0, 1fr);
			gap: 2rem;
			align-items: start;
		}
	}
</style>
