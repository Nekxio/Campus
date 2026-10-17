<script module lang="ts">
	import type { ModuleDraft } from '#lib/teaching/types.js';
	export type ModuleEditorInput = Omit<
		ModuleDraft,
		'objectives' | 'preparation' | 'studentContent'
	> & {
		studentContent: import('#lib/domain/pedagogy.js').StudentContent;
		objectives: string;
		addClassId: string;
		preparation: {
			framing: string;
			nextSteps: string;
			sourceLinks: { id: string; label: string; url: string }[];
		};
	};
</script>

<script lang="ts">
	import { tick, untrack } from 'svelte';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { z } from 'zod';
	import {
		defaults,
		setError,
		superForm,
		type FormPathLeavesWithErrors
	} from 'sveltekit-superforms';
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
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { moduleDraftSchema, validationFields } from '#lib/domain/teaching.js';
	import { saveTeaching, TeachingRequestError } from '#lib/teaching/api.js';
	import {
		captureModuleCreation,
		retainModuleCreation,
		reconcileContextRevisions,
		sameModuleDraft,
		validateModuleDetail,
		type ModuleCreationCommand
	} from '#lib/teaching/module-creation.js';
	import { fromDateInput, toDateInput } from '#lib/teaching/calendar.js';
	import type { EditorData, ModuleDetail } from '#lib/teaching/types.js';
	import EditorFields from './EditorFields.svelte';
	import LinkEditor from './LinkEditor.svelte';
	import PlanningEditor from './PlanningEditor.svelte';
	import StudentContentEditor from './StudentContentEditor.svelte';
	import { studentContentSchema, emptyStudentContent } from '#lib/domain/pedagogy.js';

	let { data }: { data: EditorData } = $props();
	// Keyed by the parent; refreshing route data cannot overwrite an unsaved form.
	const initial = untrack(() => data.module);
	let moduleId = $state(initial?.id ?? null);
	let revision = $state(initial?.revision);
	// Saved instants are metadata, not a second editable calendar store.
	let savedDates = savedDateMetadata(initial);
	const lessonInputSchema = z.strictObject({
		id: z.string(),
		title: z.string(),
		startsAt: z.string(),
		endsAt: z.string(),
		recap: z.string(),
		toDo: z.string()
	});
	const editorSchema = z
		.strictObject({
			title: z.string(),
			description: z.string(),
			objectives: z.string(),
			sourcePath: z.string(),
			addClassId: z.string(),
			preparation: z.strictObject({
				framing: z.string(),
				nextSteps: z.string(),
				sourceLinks: z.array(z.strictObject({ id: z.string(), label: z.string(), url: z.string() }))
			}),
			studentContent: studentContentSchema,
			resources: z.array(
				z.strictObject({
					id: z.string(),
					label: z.string(),
					url: z.string(),
					kind: z.enum(['course', 'instructions', 'rubric', 'resource'])
				})
			),
			contexts: z.array(
				z.strictObject({
					id: z.string(),
					classId: z.string(),
					expectedRevision: z.number().optional(),
					lessons: z.array(lessonInputSchema)
				})
			)
		})
		.superRefine((input, context) => {
			const dateIssues: string[] = [];
			const draft = toDomain(input, (path, message) => {
				dateIssues.push(path.join('.'));
				context.addIssue({ code: 'custom', path, message });
			});
			const parsed = moduleDraftSchema.safeParse(draft);
			if (!parsed.success) {
				for (const [path, message] of Object.entries(
					friendlyFields(validationFields(parsed.error))
				)) {
					if (dateIssues.includes(path)) continue;
					context.addIssue({
						code: 'custom',
						path: path.startsWith('objectives')
							? ['objectives']
							: path.split('.').map((part) => (/^\d+$/.test(part) ? Number(part) : part)),
						message
					});
				}
			}
		});
	const form = superForm<ModuleEditorInput, string>(
		defaults<ModuleEditorInput, string>(toInput(initial), zod4(editorSchema)),
		{
			SPA: true,
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
	const { form: formData, errors, allErrors } = form;
	let persistedIds = $state(initial?.contexts.map((context) => context.id) ?? []);
	let persistedLessonIds = $state(
		initial?.contexts.flatMap((context) => context.lessons.map((lesson) => lesson.id)) ?? []
	);
	let section = $state(
		untrack(() =>
			['information', 'preparation', 'resources', 'planning'].includes(
				page.url.searchParams.get('section') ?? ''
			)
				? page.url.searchParams.get('section')!
				: 'information'
		)
	);
	let pending = $state(false);
	let errorMessage = $state('');
	let conflict = $state(false);
	let status = $state('');
	let creationConfirmed = $state(false);
	let summary = $state<HTMLDivElement | null>(null);
	let confirmOpen = $state(false);
	let confirmKind = $state<'leave' | 'reload'>('leave');
	let destination = $state<ResolvedPathname>(resolve('/'));
	let allowNavigation = false;
	let creationCommand: ModuleCreationCommand | undefined;
	let baseline = $state(untrack(() => formFingerprint($formData)));
	const dirty = $derived(formFingerprint($formData) !== baseline);
	const errorEntries = $derived(
		$allErrors.map(({ path, messages }) => [path, messages[0]] as const)
	);
	const openedClass = $derived(
		data.classes.find((item) =>
			$formData.contexts.some(
				(context) =>
					context.classId === item.id &&
					(item.id === page.url.searchParams.get('classe') ||
						(!page.url.searchParams.has('classe') &&
							context.id === page.url.searchParams.get('contexte')))
			)
		)
	);
	const openedContext = $derived(
		$formData.contexts.find(
			(context) => persistedIds.includes(context.id) && context.classId === openedClass?.id
		)
	);
	const navigationScope = $derived.by((): Record<string, string> =>
		openedContext ? { classe: openedContext.classId, contexte: openedContext.id } : {}
	);
	const moduleQuery = $derived(new URLSearchParams({ ...navigationScope, section }).toString());
	const rubricQuery = $derived(
		new URLSearchParams({ ...navigationScope, section, retour: 'module' }).toString()
	);
	const sections = [
		{ value: 'information', label: 'Informations' },
		{ value: 'preparation', label: 'Préparation' },
		{ value: 'resources', label: 'Liens étudiants' },
		{ value: 'planning', label: 'Classes et planning' }
	];
	function formFingerprint(input: ModuleEditorInput) {
		const comparable = {
			...input,
			preparation: {
				...input.preparation,
				// Private reference IDs are UI keys, absent from the saved domain payload.
				sourceLinks: input.preparation.sourceLinks.map(({ label, url }) => ({ label, url }))
			}
		};
		return JSON.stringify(comparable, (_key, value: unknown) =>
			value && typeof value === 'object' && !Array.isArray(value)
				? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
				: value
		);
	}

	function savedDateMetadata(module: ModuleDetail | null) {
		return Object.fromEntries(
			(module?.contexts ?? []).flatMap((context) =>
				context.lessons.map((lesson) => [
					lesson.id,
					{
						startsAt: { local: toDateInput(lesson.startsAt), instant: lesson.startsAt },
						endsAt: { local: toDateInput(lesson.endsAt), instant: lesson.endsAt }
					}
				])
			)
		);
	}
	function toInput(module: ModuleDetail | null): ModuleEditorInput {
		return {
			title: module?.title ?? '',
			description: module?.description ?? '',
			objectives: module?.objectives.join('\n') ?? '',
			sourcePath: module?.sourcePath ?? '',
			studentContent: structuredClone(module?.studentContent ?? emptyStudentContent()),
			addClassId: '',
			preparation: {
				framing: module?.preparation.framing ?? '',
				nextSteps: module?.preparation.nextSteps ?? '',
				sourceLinks: (module?.preparation.sourceLinks ?? []).map((link, index) => ({
					...link,
					id: `private-source-${index}`
				}))
			},
			resources: (module?.resources ?? []).map((row) => ({ ...row })),
			contexts: (module?.contexts ?? []).map((context) => ({
				...context,
				lessons: context.lessons.map((lesson) => ({
					...lesson,
					startsAt: toDateInput(lesson.startsAt),
					endsAt: toDateInput(lesson.endsAt)
				}))
			}))
		};
	}
	function toDomain(
		input: ModuleEditorInput,
		issue?: (path: (string | number)[], message: string) => void
	): ModuleDraft {
		return {
			title: input.title,
			description: input.description,
			objectives: input.objectives
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean),
			sourcePath: input.sourcePath,
			studentContent: structuredClone(input.studentContent),
			preparation: {
				framing: input.preparation.framing,
				nextSteps: input.preparation.nextSteps,
				sourceLinks: input.preparation.sourceLinks.map(({ label, url }) => ({ label, url }))
			},
			resources: input.resources.map((row) => ({ ...row })),
			contexts: input.contexts.map((context, contextIndex) => ({
				...context,
				lessons: context.lessons.map((lesson, lessonIndex) => {
					const dates = { startsAt: '', endsAt: '' };
					for (const field of ['startsAt', 'endsAt'] as const) {
						const raw = lesson[field];
						const saved = savedDates[lesson.id]?.[field];
						if (saved?.local === raw) dates[field] = saved.instant;
						else if (raw) {
							try {
								dates[field] = fromDateInput(raw);
							} catch {
								issue?.(
									['contexts', contextIndex, 'lessons', lessonIndex, field],
									'Cette heure n’existe pas ou est ambiguë lors du changement d’heure. Choisissez une autre heure.'
								);
							}
						}
					}
					return { ...lesson, ...dates };
				})
			}))
		};
	}
	function applySaved(value: ModuleDetail) {
		creationConfirmed = false;
		moduleId = value.id;
		revision = value.revision;
		savedDates = savedDateMetadata(value);
		form.reset({ data: toInput(value), newState: toInput(value) });
		persistedIds = value.contexts.map((context) => context.id);
		persistedLessonIds = value.contexts.flatMap((context) =>
			context.lessons.map((lesson) => lesson.id)
		);
		conflict = false;
		errorMessage = '';
		baseline = formFingerprint($formData);
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
			contexts: 'Classes et planning',
			resources: 'Liens étudiants',
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
	function friendlyFields(values: Record<string, string>): Record<string, string> {
		return Object.fromEntries(
			Object.entries(values).map(([path, message]) => {
				if (path.endsWith('.url'))
					return [path, 'Renseignez un lien HTTPS valide, sans identifiant ni mot de passe.'];
				if (path.endsWith('.startsAt')) return [path, 'Renseignez la date et l’heure de début.'];
				if (path.endsWith('.endsAt') && message !== 'La fin doit suivre le début.')
					return [path, 'Renseignez la date et l’heure de fin.'];
				if (path === 'title' || path.endsWith('.title') || path.endsWith('.label'))
					return [path, 'Renseignez un intitulé de 1 à 200 caractères.'];
				return [path, message];
			})
		);
	}
	function applyRequestErrors(fields: Record<string, string>) {
		const snapshot = form.capture();
		for (const [rawPath, message] of Object.entries(friendlyFields(fields))) {
			let path = rawPath.startsWith('objectives')
				? 'objectives'
				: rawPath.replace(/\.(\d+)(?=\.|$)/g, '[$1]');
			if (/^(resources|contexts|preparation\.sourceLinks)$/.test(path) || path.endsWith('.lessons'))
				path += '._errors';
			if (
				!/^(title|description|objectives|sourcePath|preparation|resources|contexts|addClassId)(\.|\[|$)/.test(
					path
				)
			)
				path = '';
			setError(snapshot, path as FormPathLeavesWithErrors<ModuleEditorInput> | '', message, {
				overwrite: true
			});
		}
		errors.set(snapshot.errors);
	}
	async function focusErrors() {
		if ($allErrors[0]) section = sectionFor($allErrors[0].path);
		await tick();
		summary?.focus();
	}
	async function jumpToError(path: string) {
		section = sectionFor(path);
		await tick();
		const name = path.replace(/\.(\d+)/g, '[$1]').replace(/\._errors$/, '');
		const fields = [...document.querySelectorAll<HTMLElement>('#module-form [name]')];
		const target =
			fields.find((field) => field.getAttribute('name') === name) ??
			fields.find(
				(field) =>
					field.getAttribute('name')?.startsWith(`${name}.`) ||
					field.getAttribute('name')?.startsWith(`${name}[`)
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
		if (pending) return;
		pending = true;
		errorMessage = '';
		status = '';
		creationConfirmed = false;
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
				payload = moduleDraftSchema.parse(toDomain(validated.data));
				if (creating)
					command = creationCommand = captureModuleCreation(crypto.randomUUID(), payload);
			}
			const requestedId = command?.id ?? moduleId;
			if (!requestedId) throw new Error('Missing module identity.');
			const saved = validateModuleDetail(
				creating
					? await saveTeaching<unknown>('/api/teaching/modules', payload, 'POST', requestedId)
					: await saveTeaching<unknown>(
							`/api/teaching/modules/${moduleId}`,
							{ ...payload, expectedRevision: revision },
							'PATCH'
						),
				requestedId
			);
			if (command && !sameModuleDraft(toDomain($formData), command.payload)) {
				const contexts = reconcileContextRevisions($formData.contexts, saved);
				moduleId = saved.id;
				revision = saved.revision;
				savedDates = savedDateMetadata(saved);
				persistedIds = saved.contexts.map((context) => context.id);
				persistedLessonIds = saved.contexts.flatMap((context) =>
					context.lessons.map((lesson) => lesson.id)
				);
				baseline = formFingerprint(toInput(saved));
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
			status = creating ? 'Brouillon créé.' : 'Module enregistré.';
			if (creating) {
				try {
					allowNavigation = true;
					await goto(resolve('/enseignant/modules/[moduleId]', { moduleId: saved.id }));
				} catch {
					status = 'Brouillon créé. Vous pouvez continuer à le modifier ici.';
				} finally {
					allowNavigation = false;
				}
			} else {
				try {
					await refreshAll();
				} catch {
					status = 'Module enregistré. L’actualisation de la page est indisponible.';
				}
			}
		} catch (error) {
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
				applyRequestErrors(error.fields);
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
		if (allowNavigation || (!dirty && !pending && !creationCommand)) return;
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
			errorMessage = 'Impossible d’ouvrir cette page. Vos saisies sont conservées.';
			await focusErrors();
		} finally {
			allowNavigation = false;
		}
	}
	async function cancelEditing() {
		try {
			await goto(
				openedClass ? resolve(`/enseignant/classes?classe=${openedClass.id}`) : resolve('/#modules')
			);
		} catch {
			if (!confirmOpen) {
				errorMessage = 'Impossible d’ouvrir l’accueil. Vos saisies sont conservées.';
				await focusErrors();
			}
		}
	}
</script>

<div class="module-editor flex min-w-0 flex-col gap-7">
	{#if data.module?.needsReview}<Alert.Root role="region" aria-label="Brouillon à relire">
			<CircleAlertIcon aria-hidden="true" /><Alert.Title
				>Brouillon à relire avant publication</Alert.Title
			>
			<Alert.Description
				><ul>
					{#each data.module.agentChanges ?? [] as change, index (index)}<li>{change}</li>{/each}
				</ul>
				La page publique conserve sa dernière version jusqu’à votre décision dans Publication.</Alert.Description
			>
		</Alert.Root>{/if}
	<div class="flex min-w-0 flex-col gap-3">
		<div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
			<h1 class="min-w-0 text-3xl font-semibold tracking-tight sm:text-4xl">
				{moduleId ? 'Modifier le module' : 'Créer un module'}
			</h1>
			<div class="flex flex-wrap items-center gap-3">
				{#if data.publishedPath}<Button
						variant="outline"
						href={data.publishedPath}
						target="_blank"
						rel="noopener noreferrer"
						><ExternalLinkIcon data-icon="inline-start" />Voir la page publiée<span class="sr-only">
							· nouvel onglet</span
						></Button
					>{/if}
				{#if moduleId}<Button
						variant="outline"
						href={`${resolve('/enseignant/modules/[moduleId]/publication', { moduleId })}?${moduleQuery}`}
						>Publication</Button
					><Button
						variant="outline"
						href={`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId })}?${rubricQuery}`}
						>Barème</Button
					><Button
						variant="outline"
						href={`${resolve('/enseignant/notation')}?${new URLSearchParams({ module: moduleId, ...(openedContext ? { contexte: openedContext.id } : {}) })}`}
						>Notation</Button
					>{/if}
				<Button
					type="button"
					variant="outline"
					class="min-h-11"
					disabled={pending}
					onclick={cancelEditing}>Annuler</Button
				>
			</div>
		</div>
		{#if moduleId}<p class="text-lg font-medium wrap-anywhere">
				{$formData.title || initial?.title}
			</p>{/if}
		{#if openedClass}<p class="text-sm text-muted-foreground">
				{openedClass.name} · {openedClass.academicYear}
			</p>{/if}
		<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
			{moduleId
				? 'Retrouvez les informations, les supports et le planning du module.'
				: 'Préparez le module avant de le rattacher à une classe.'}
		</p>
	</div>
	{#if errorMessage || errorEntries.length > 0}
		<Alert.Root
			variant="destructive"
			bind:ref={summary}
			tabindex={-1}
			class="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
		>
			<CircleAlertIcon aria-hidden="true" />
			<Alert.Title
				>{conflict ? 'Version à actualiser' : 'Des champs nécessitent votre attention'}</Alert.Title
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
	<form id="module-form" novalidate onsubmit={save} aria-busy={pending}>
		<fieldset disabled={pending} class="min-w-0">
			<Tabs.Root orientation="horizontal" bind:value={section} class="module-layout">
				<div class="section-rail hidden min-w-0 lg:block">
					<Tabs.List aria-label="Sections du module" class="w-full flex-wrap gap-1">
						{#each sections as item (item.value)}
							<Tabs.Trigger value={item.value} class="min-h-11 flex-1 whitespace-normal">
								{item.label}
							</Tabs.Trigger>
						{/each}
					</Tabs.List>
				</div>
				<div class="min-w-0 lg:hidden">
					<Field.FieldGroup>
						<Field.Field>
							<Field.FieldLabel for="module-section">Section du module</Field.FieldLabel>
							<NativeSelect.Root id="module-section" bind:value={section} class="w-full">
								{#each sections as item (item.value)}<NativeSelect.Option value={item.value}
										>{item.label}</NativeSelect.Option
									>{/each}
							</NativeSelect.Root>
						</Field.Field>
					</Field.FieldGroup>
				</div>
				<div class="min-w-0">
					<Tabs.Content value="information" class="min-w-0">
						<div class="flex flex-col gap-2">
							<h2 class="text-xl font-semibold tracking-tight sm:text-2xl">Informations</h2>
							<p class="text-sm leading-relaxed text-muted-foreground">
								{moduleId
									? 'Ces informations identifient le module et peuvent être publiées après vérification.'
									: 'Seul le nom est nécessaire pour créer le brouillon.'}
							</p>
						</div>
						<div class="identity-layout mt-6 grid min-w-0 gap-8">
							<Field.FieldGroup class="min-w-0 gap-6">
								<EditorFields
									id="module-title"
									label="Nom du module"
									{form}
									name="title"
									required
									maxlength={200}
								/>
								<EditorFields
									id="module-description"
									label="Description"
									multiline
									{form}
									name="description"
									maxlength={20000}
								/>
								<EditorFields
									id="module-objectives"
									label="Objectifs pédagogiques"
									multiline
									{form}
									name="objectives"
									description="Un objectif par ligne."
								/>
								<p class="text-sm text-muted-foreground">
									Le module est conservé d’une année à l’autre.
								</p>
							</Field.FieldGroup>
							<aside class="completion-hints flex flex-col gap-7" aria-label="Compléter le module">
								{#if moduleId}
									<h3 class="font-medium">Dans ce module</h3>
									<dl class="grid gap-5 text-sm">
										<div class="flex flex-col gap-1">
											<dt class="text-muted-foreground">Classes associées</dt>
											<dd class="text-base font-medium tabular-nums">
												{$formData.contexts.length}
											</dd>
										</div>
										<div class="flex flex-col gap-1">
											<dt class="text-muted-foreground">Liens étudiants</dt>
											<dd class="text-base font-medium tabular-nums">
												{$formData.resources.length}
											</dd>
										</div>
									</dl>
									<Button type="button" variant="outline" onclick={() => (section = 'planning')}
										>Classes et planning</Button
									>
								{:else}
									<section class="flex flex-col items-start gap-2">
										<h3 class="text-sm font-medium">Classes et planning</h3>
										<p class="text-sm leading-relaxed text-muted-foreground">
											Facultatif. Rattachez une classe et organisez son planning quand vous êtes
											prêt.
										</p>
									</section>
									<section class="flex flex-col gap-2">
										<h3 class="text-sm font-medium">Préparation</h3>
										<p class="text-sm leading-relaxed text-muted-foreground">
											Ajoutez vos références et documents de travail privés.
										</p>
									</section>
									<section class="flex flex-col gap-2">
										<h3 class="text-sm font-medium">Liens étudiants</h3>
										<p class="text-sm leading-relaxed text-muted-foreground">
											Renseignez les liens vers les supports choisis pour les étudiants.
										</p>
									</section>
								{/if}
							</aside>
						</div>
					</Tabs.Content>
					<Tabs.Content value="preparation" class="min-w-0">
						<div class="flex flex-col gap-2">
							<h2 class="text-xl font-semibold tracking-tight sm:text-2xl">Préparation</h2>
							<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
								Vos notes et références de travail restent dans l’espace enseignant.
							</p>
						</div>
						<Field.FieldGroup class="mt-6 gap-6">
							<EditorFields
								id="module-framing"
								label="Cadrage pédagogique"
								multiline
								{form}
								name="preparation.framing"
								maxlength={20000}
							/>
							<EditorFields
								id="module-nextSteps"
								label="Prochaines étapes"
								multiline
								{form}
								name="preparation.nextSteps"
								maxlength={20000}
							/>
							<EditorFields
								id="module-sourcePath"
								label="Dossier source local"
								{form}
								name="sourcePath"
								maxlength={2000}
								description="Une référence textuelle privée vers votre dossier de travail. Coursely n’ouvre pas les fichiers de votre ordinateur."
							/>
							<LinkEditor {form} />
						</Field.FieldGroup>
					</Tabs.Content>
					<Tabs.Content value="resources" class="min-w-0">
						<div class="flex flex-col gap-2">
							<h2 class="text-xl font-semibold tracking-tight sm:text-2xl">Liens étudiants</h2>
							<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
								Choisissez les liens des supports du module. Pour remplacer un document, modifiez
								son lien puis enregistrez.
							</p>
						</div>
						<div class="mt-6">
							<LinkEditor {form} student />
							<div class="mt-8"><StudentContentEditor {form} /></div>
						</div>
					</Tabs.Content>
					<Tabs.Content value="planning" class="min-w-0">
						<div class="flex flex-col gap-2">
							<h2 class="text-xl font-semibold tracking-tight sm:text-2xl">Classes et planning</h2>
							<p class="max-w-prose text-sm leading-relaxed text-muted-foreground">
								Ce module appartient à une seule classe. Les dates sont saisies à l’heure de Paris
								(Europe/Paris).
							</p>
						</div>
						<div class="mt-6">
							{#if moduleId}<Button
									class="mb-5"
									variant="outline"
									href={`${resolve('/enseignant/modules/[moduleId]/bareme', { moduleId })}?${rubricQuery}#echeances${openedContext ? '-' + openedContext.id : ''}`}
									>Régler les échéances des évaluations</Button
								>{/if}
							<PlanningEditor {form} classes={data.classes} {persistedIds} {persistedLessonIds} />
						</div>
					</Tabs.Content>
				</div>
			</Tabs.Root>
		</fieldset>
	</form>
	<div class="editor-save-bar">
		<div role="status" aria-live="polite" class="min-h-5 text-sm text-muted-foreground">
			{pending
				? 'Enregistrement du module en cours…'
				: dirty
					? creationConfirmed
						? 'Brouillon créé. Vos modifications actuelles restent à enregistrer.'
						: 'Modifications non enregistrées.'
					: status ||
						(moduleId
							? 'Toutes les modifications sont enregistrées.'
							: 'Le brouillon n’est pas encore créé.')}
		</div>
		<Button type="submit" form="module-form" disabled={pending}
			>{#if pending}<Spinner data-icon="inline-start" />{/if}{pending
				? 'Enregistrement…'
				: moduleId
					? 'Enregistrer le module'
					: 'Créer le brouillon'}</Button
		>
	</div>
</div>

<AlertDialog.Root bind:open={confirmOpen}>
	<AlertDialog.Content class="max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] overflow-y-auto">
		<AlertDialog.Header>
			<AlertDialog.Title
				>{confirmKind === 'reload'
					? 'Recharger le module ?'
					: 'Quitter le module ?'}</AlertDialog.Title
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
				>{confirmKind === 'reload'
					? 'Recharger et remplacer'
					: 'Quitter sans enregistrer'}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	.module-editor :global(.module-layout) {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 2rem;
		border-top: 1px solid var(--border);
		padding-top: 2rem;
	}
	.module-editor :global([data-slot='native-select']) {
		min-height: 2.75rem;
		font-size: 1rem;
	}
	.section-rail {
		border-bottom: 1px solid var(--border);
		padding-bottom: 1rem;
	}
	.section-rail :global([data-slot='tabs-list']) {
		background: transparent;
		padding: 0;
		align-items: stretch;
	}
	.section-rail :global([data-slot='tabs-trigger']) {
		flex: initial;
		border-radius: var(--radius-xl);
	}
	.section-rail :global([data-slot='tabs-trigger'][data-state='active']) {
		background: var(--muted);
		color: var(--foreground);
	}
	.section-rail :global([data-slot='tabs-trigger']::after) {
		display: none;
	}
	@media (min-width: 64rem) {
		.module-editor :global(.module-layout) {
			grid-template-columns: minmax(0, 1fr);
			gap: 2.5rem;
		}
	}
	@media (min-width: 80rem) {
		.identity-layout {
			grid-template-columns: minmax(0, 1fr) 220px;
		}
		.completion-hints {
			border-left: 1px solid var(--border);
			padding-left: 1.5rem;
		}
		.module-editor :global([data-slot='native-select']) {
			font-size: 0.875rem;
		}
	}
	@media (pointer: coarse) {
		.module-editor :global([data-slot='input']),
		.module-editor :global([data-slot='textarea']),
		.module-editor :global([data-slot='native-select']) {
			font-size: 1rem;
		}
	}
</style>
