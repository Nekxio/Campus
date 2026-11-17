<script lang="ts">
	import { tick } from 'svelte';
	import { notify } from '#lib/client/notifications.js';
	import { focusFirstInvalidField } from '#lib/client/form-feedback.js';
	import { z } from 'zod';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4Client } from 'sveltekit-superforms/adapters';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import ClipboardIcon from '@lucide/svelte/icons/clipboard-paste';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Alert from '#lib/components/ui/alert/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { studentDeleteSchema, studentNameSchema } from '#lib/domain/teaching.js';
	import { previewRoster } from '#lib/domain/roster-import.js';
	import { TeachingRequestError } from '#lib/teaching/api.js';
	import { createFormActionTransport } from '#lib/teaching/form-actions.js';
	import { identityResponse, rosterReceiptSchema } from '#lib/teaching/action-responses.js';
	import type { ClassDetail, StudentRecord } from '#lib/teaching/types.js';
	import ClassMutationFeedback from './ClassMutationFeedback.svelte';
	import PrivacyNotice from '#lib/components/legal/PrivacyNotice.svelte';

	let {
		record,
		onSaved,
		onReload
	}: {
		record: ClassDetail;
		onSaved: (message: string) => Promise<boolean>;
		onReload: () => Promise<void>;
	} = $props();
	let search = $state({ classId: '', value: '' });
	const searchQuery = $derived(search.classId === record.id ? search.value : '');
	const visibleStudents = $derived(
		record.students.filter((student) =>
			student.name.toLocaleLowerCase('fr').includes(searchQuery.trim().toLocaleLowerCase('fr'))
		)
	);
	type Editor = 'add' | 'edit' | 'import';
	type Draft = {
		class: ClassDetail;
		student: StudentRecord | null;
		name: string;
		source: string;
		saveUnconfirmed: boolean;
	};
	// Page-local only: never persist roster data in browser storage or an SSR singleton.
	const retainedDrafts: Record<string, Draft | undefined> = Object.create(null);
	let editorKey = $state('');
	let editorCommitted = false;
	function retainEditor(open: boolean) {
		if (open || !editor || !openedClass || editorCommitted) return;
		if ($studentData.name !== (openedStudent?.name ?? '') || $importData.source.trim() || saveUnconfirmed) {
			retainedDrafts[editorKey] = {
				class: openedClass,
				student: openedStudent,
				name: $studentData.name,
				source: $importData.source,
				saveUnconfirmed
			};
		} else delete retainedDrafts[editorKey];
	}
	function discardEditorDraft() {
		editorCommitted = true;
		delete retainedDrafts[editorKey];
	}

	let editor = $state<Editor | null>(null);
	let editorOpen = $state(false);
	let editorOpener: HTMLElement | null = null;
	let completeEditorClose: (() => void) | undefined;
	let openedClass = $state.raw<ClassDetail | null>(null);
	let openedStudent = $state.raw<StudentRecord | null>(null);
	const studentSchema = z.strictObject({ name: studentNameSchema });
	const studentForm = superForm(defaults({ name: '' }, zod4Client(studentSchema)), {
		id: 'class-student-name',
		validators: zod4Client(studentSchema),
		dataType: 'json',
		invalidateAll: false,
		applyAction: 'never',
		resetForm: false,
		taintedMessage: false
	});
	const { form: studentData, errors: studentErrors } = studentForm;
	const importSchema = z.strictObject({
		source: z
			.string()
			.min(1, 'Ajoutez au moins un nom.')
			.max(200000, 'La liste est trop volumineuse.')
			.superRefine((value, ctx) => {
				if (!value.trim()) {
					ctx.addIssue({ code: 'custom', message: 'Ajoutez au moins un nom.' });
					return;
				}
				const result = previewRoster(value, openedClass?.students.map((student) => student.name) ?? []);
				if (result.errors.length)
					ctx.addIssue({ code: 'custom', message: 'Corrigez les erreurs de la liste ci-dessous.' });
				else if (!result.names.length) ctx.addIssue({ code: 'custom', message: 'Aucun nouveau nom à ajouter.' });
			}),
		file: z.custom<File | null>(
			(value) => value === null || (typeof File !== 'undefined' && value instanceof File && value.size <= 200000),
			'Choisissez un fichier de 200 Ko maximum. La liste déjà saisie est conservée.'
		)
	});
	const importForm = superForm(defaults({ source: '', file: null }, zod4Client(importSchema)), {
		id: 'class-roster-import',
		validators: zod4Client(importSchema),
		dataType: 'json',
		invalidateAll: false,
		applyAction: 'never',
		resetForm: false,
		taintedMessage: false
	});
	const { form: importData, errors: importErrors } = importForm;
	const studentTransport = createFormActionTransport(studentForm);
	const importTransport = createFormActionTransport(importForm);
	const deleteForm = superForm(
		defaults({ confirm: true, expectedRevision: 0, classRevision: 0 }, zod4Client(studentDeleteSchema)),
		{
			id: 'class-student-delete',
			dataType: 'json',
			applyAction: 'never',
			invalidateAll: false,
			resetForm: false,
			taintedMessage: false
		}
	);
	const deleteTransport = createFormActionTransport(deleteForm);
	const enhanceEditor = (element: HTMLFormElement) =>
		(editor === 'import' ? importTransport : studentTransport).enhance(element);
	const submitEditor = (event: SubmitEvent & { currentTarget: HTMLFormElement }) =>
		(editor === 'import' ? importTransport : studentTransport).handleSubmit(save)(event);
	let pending = $state(false);
	let validating = false;
	let saveUnconfirmed = $state(false);
	const canSaveName = $derived(editor !== 'edit' || $studentData.name !== openedStudent?.name || saveUnconfirmed);
	let readingFile = $state(false);
	let error = $state.raw<TeachingRequestError | null>(null);
	let deleteOpen = $state(false);
	let deleteClass = $state.raw<ClassDetail | null>(null);
	let deleteStudent = $state.raw<StudentRecord | null>(null);
	let deleting = $state(false);
	let deleteError = $state.raw<TeachingRequestError | null>(null);
	const preview = $derived(
		$importData.source.trim()
			? previewRoster($importData.source, openedClass?.students.map((student) => student.name) ?? [])
			: { names: [], duplicates: [], errors: [] }
	);
	const skippedNames = $derived([...new Set(preview.duplicates)]);

	const initials = (value: string) => {
		const parts = value.trim().split(/\s+/);
		return [parts[0], parts.length > 1 ? parts.at(-1) : undefined]
			.filter((part) => part !== undefined)
			.map((part) => Array.from(part)[0])
			.join('')
			.toLocaleUpperCase('fr');
	};

	function showEditor(mode: Editor, opener: HTMLElement, student: StudentRecord | null = null) {
		editorOpener = opener;
		editorKey = `${record.id}:${mode}:${student?.id ?? ''}`;
		editorCommitted = false;
		const retained = retainedDrafts[editorKey];
		saveUnconfirmed = retained?.saveUnconfirmed ?? false;
		openedClass = retained?.class ?? record;
		openedStudent = retained?.student ?? student;
		studentForm.reset({
			id: student ? `class-student-${record.id}-${student.id}` : `class-student-${record.id}-new`,
			data: { name: retained?.name ?? student?.name ?? '' }
		});
		importForm.reset({
			id: `class-roster-import-${record.id}`,
			data: { source: retained?.source ?? '', file: null }
		});
		error = null;
		editor = mode;
		editorOpen = true;
	}

	function closeEditor() {
		if (pending || readingFile) return;
		editorOpen = false;
	}

	async function restoreEditorFocus(event: Event) {
		event.preventDefault();
		const opener = editorOpener;
		const complete = completeEditorClose;
		completeEditorClose = undefined;
		await tick();
		if (!editorOpen && !complete && opener?.isConnected) opener.focus({ preventScroll: true });
		complete?.();
	}

	const readFile = async (event: Event & { currentTarget: HTMLInputElement }) => {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (!file) return;
		$importData.file = file;
		$importErrors.file = undefined;
		if (file.size > 200000) {
			await importForm.validate('file', { update: true });
			notify('Choisissez un fichier de 200 Ko maximum. La liste déjà saisie est conservée.', 'error');
			input.value = '';
			return;
		}
		readingFile = true;
		try {
			$importData.source = await file.text();
			error = null;
			const validated = await importForm.validateForm({ update: true });
			if (!validated.valid) notify('Vérifiez les erreurs de la liste importée.', 'error');
		} catch {
			$importErrors.file = ['Le fichier ne peut pas être lu. Réessayez ou collez la liste.'];
			notify($importErrors.file[0], 'error');
		} finally {
			readingFile = false;
			input.value = '';
		}
	};

	const save = async (event: SubmitEvent & { currentTarget: HTMLFormElement }) => {
		event.preventDefault();
		const formElement = event.currentTarget;
		if (validating || pending || readingFile || !openedClass || !editor || !canSaveName) return;
		error = null;
		validating = true;
		try {
			let validName = '';
			let validSource = '';
			if (editor === 'import') {
				const validated = await importForm.validateForm({ update: true });
				if (!validated.valid) {
					notify('Vérifiez les champs indiqués. Vos saisies sont conservées.', 'error');
					await focusFirstInvalidField(formElement);
					return;
				}
				validSource = validated.data.source;
			} else {
				const validated = await studentForm.validateForm({ update: true });
				if (!validated.valid) {
					notify('Vérifiez les champs indiqués. Vos saisies sont conservées.', 'error');
					await focusFirstInvalidField(formElement);
					return;
				}
				validName = validated.data.name;
			}
			pending = true;
			let message;
			if (editor === 'edit' && openedStudent) {
				await studentTransport.submit(
					'/enseignant/classes?/updateStudent',
					{
						classId: openedClass.id,
						studentId: openedStudent.id,
						name: validName,
						expectedRevision: openedStudent.revision,
						classRevision: openedClass.revision
					},
					identityResponse(openedStudent.id)
				);
				message = 'Le nom de l’étudiant a été enregistré.';
			} else if (editor === 'import') {
				const result = await importTransport.submit(
					'/enseignant/classes?/importStudents',
					{
						classId: openedClass.id,
						kind: 'import',
						source: validSource,
						expectedRevision: openedClass.revision
					},
					rosterReceiptSchema.parse
				);
				message = `${result.added} étudiant${result.added > 1 ? 's' : ''} ajouté${result.added > 1 ? 's' : ''}.`;
				if (result.skipped)
					message += ` ${result.skipped} doublon${result.skipped > 1 ? 's' : ''} ignoré${result.skipped > 1 ? 's' : ''}.`;
			} else {
				await studentTransport.submit(
					'/enseignant/classes?/addStudent',
					{
						classId: openedClass.id,
						kind: 'add',
						name: validName,
						expectedRevision: openedClass.revision
					},
					rosterReceiptSchema.parse
				);
				message = 'L’étudiant a été ajouté à la classe.';
			}
			discardEditorDraft();
			const opener = editorOpener;
			const closed = new Promise<void>((resolve) => {
				completeEditorClose = resolve;
			});
			editorOpen = false;
			// Let the modal release its focus trap before the parent can focus a refresh failure.
			await closed;
			const refreshed = await onSaved(message);
			await tick();
			if (refreshed && opener?.isConnected) opener.focus({ preventScroll: true });
		} catch (cause) {
			error =
				cause instanceof TeachingRequestError
					? cause
					: new TeachingRequestError(0, 'Enregistrement indisponible. Réessayez.');
			if (editor === 'edit' && !error.decodedServerError) saveUnconfirmed = true;
			if (editor === 'import') $importErrors.source = error.fields.source ? [error.fields.source] : undefined;
			else $studentErrors.name = error.fields.name ? [error.fields.name] : undefined;
		} finally {
			validating = false;
			pending = false;
		}
	};

	let deleteOpener: HTMLElement | null = null;
	const showDelete = (student: StudentRecord, opener: HTMLElement) => {
		deleteOpener = opener;
		deleteClass = record;
		deleteStudent = student;
		deleteError = null;
		deleteOpen = true;
	};

	async function remove(event: MouseEvent) {
		event.preventDefault();
		if (deleting || !deleteStudent || !deleteClass) return;
		deleting = true;
		deleteError = null;
		try {
			await deleteTransport.submit(
				'/enseignant/classes?/removeStudent',
				{
					classId: deleteClass.id,
					studentId: deleteStudent.id,
					confirm: true,
					expectedRevision: deleteStudent.revision,
					classRevision: deleteClass.revision
				},
				identityResponse(deleteStudent.id)
			);
			deleteOpen = false;
			await onSaved('L’étudiant et ses données associées ont été supprimés de la classe.');
			await tick();
			document.getElementById('roster-title')?.focus();
		} catch (cause) {
			deleteError =
				cause instanceof TeachingRequestError
					? cause
					: new TeachingRequestError(0, 'Suppression indisponible. Réessayez.');
		} finally {
			deleting = false;
		}
	}

	async function reloadEditor() {
		await onReload();
		await tick();
		discardEditorDraft();
		editorOpen = false;
	}
	async function reloadDelete() {
		await onReload();
		deleteOpen = false;
	}
</script>

<form method="POST" use:deleteTransport.enhance class="hidden" aria-hidden="true"></form>

<section aria-labelledby="roster-title" class="roster-content min-w-0">
	<div class="mb-2 flex items-center gap-3">
		<h3 id="roster-title" tabindex="-1" class="text-lg font-semibold tracking-tight">Étudiants</h3>
		<span class="text-sm text-muted-foreground tabular-nums">{record.students.length}</span>
	</div>
	<p class="text-sm text-muted-foreground">Une liste commune à tous les modules de l’année.</p>
	<div class="roster-actions my-4 flex flex-wrap justify-end gap-2">
		<Button variant="outline" class="min-h-11" onclick={(event) => showEditor('import', event.currentTarget)}>
			<ClipboardIcon data-icon="inline-start" aria-hidden="true" />Importer une liste
		</Button>
		<Button class="min-h-11" onclick={(event) => showEditor('add', event.currentTarget)}>
			<PlusIcon data-icon="inline-start" aria-hidden="true" />Ajouter un étudiant
		</Button>
	</div>
	{#if record.students.length}
		<Field.FieldGroup class="mb-4">
			<Field.Field
				><Field.FieldLabel for="roster-search">Rechercher un étudiant</Field.FieldLabel><Input
					id="roster-search"
					type="search"
					bind:value={() => searchQuery, (value) => (search = { classId: record.id, value: String(value ?? '') })}
					placeholder="Nom de l’étudiant…"
				/></Field.Field
			>
		</Field.FieldGroup>
		{#if !visibleStudents.length}<Empty.Root
				><Empty.Header
					><Empty.Title>Aucun étudiant trouvé</Empty.Title><Empty.Description
						>Essayez un autre nom dans cette classe.</Empty.Description
					></Empty.Header
				><Empty.Content
					><Button variant="outline" onclick={() => (search = { classId: record.id, value: '' })}
						>Effacer la recherche</Button
					></Empty.Content
				></Empty.Root
			>{/if}
		<p class="mb-3 text-sm text-muted-foreground" role="status">
			{visibleStudents.length} sur {record.students.length} étudiant{record.students.length > 1 ? 's' : ''}
		</p>
		<div class="roster-table overflow-hidden rounded-lg bg-card">
			<Table.Root class="table-fixed" aria-label={`Étudiants de ${record.name}, ${record.academicYear}`}>
				<Table.Header>
					<Table.Row class="bg-muted/40">
						<Table.Head class="w-14"><span class="sr-only">Initiales</span></Table.Head>
						<Table.Head>Nom de l’étudiant</Table.Head>
						<Table.Head class="w-28"><span class="sr-only">Actions</span></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each visibleStudents as student (student.id)}
						<Table.Row>
							<Table.Cell class="py-1">
								<Avatar.Root class="size-7" aria-hidden="true"
									><Avatar.Fallback>{initials(student.name)}</Avatar.Fallback></Avatar.Root
								>
							</Table.Cell>
							<Table.Cell class="py-2 break-words whitespace-normal">{student.name}</Table.Cell>
							<Table.Cell class="p-2">
								<div class="flex items-center justify-end gap-1">
									<Button
										variant="ghost"
										size="icon"
										class="size-11"
										aria-label={`Modifier ${student.name}`}
										onclick={(event) => showEditor('edit', event.currentTarget, student)}
										><PencilIcon aria-hidden="true" /></Button
									>
									<Button
										variant="destructive-ghost"
										size="icon"
										aria-label={`Supprimer ${student.name}`}
										onclick={(event) => showDelete(student, event.currentTarget)}
										><TrashIcon aria-hidden="true" /></Button
									>
								</div>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
	{:else}
		<Empty.Root class="rounded-container bg-muted p-(--space-content)">
			<Empty.Header>
				<Empty.Media variant="icon"><UsersIcon aria-hidden="true" /></Empty.Media>
				<Empty.Title>Aucun étudiant dans cette classe</Empty.Title>
				<Empty.Description>Importez une liste ou ajoutez le premier étudiant de {record.name}.</Empty.Description>
			</Empty.Header>
		</Empty.Root>
	{/if}
	<p class="mt-3 text-xs text-muted-foreground">Import par copier-coller ou fichier CSV. Aucun compte étudiant.</p>
</section>

<Dialog.Root
	bind:open={editorOpen}
	onOpenChange={retainEditor}
	onOpenChangeComplete={(value) => {
		if (!value && !editorOpen) {
			retainEditor(false);
			editor = null;
		}
	}}
>
	{#if editor}
		<Dialog.Content
			showCloseButton={false}
			class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
			onCloseAutoFocus={restoreEditorFocus}
			onEscapeKeydown={(event) => {
				if (pending || readingFile) event.preventDefault();
			}}
			onInteractOutside={(event) => {
				if (pending || readingFile) event.preventDefault();
			}}
		>
			<Dialog.Header>
				<Dialog.Title
					>{editor === 'import'
						? 'Importer les étudiants'
						: editor === 'edit'
							? 'Modifier le nom'
							: 'Ajouter un étudiant'}</Dialog.Title
				>
				<Dialog.Description class="wrap-anywhere">
					{editor === 'import'
						? 'Vérifiez les noms avant de les ajouter à la liste commune de la classe.'
						: `Liste de ${openedClass?.name} · ${openedClass?.academicYear}.`}
				</Dialog.Description>
			</Dialog.Header>
			{#key editorKey}
				<form
					method="POST"
					novalidate
					use:enhanceEditor
					onsubmit={submitEditor}
					class="flex flex-col gap-6"
					aria-busy={pending || readingFile}
				>
					<PrivacyNotice>
						Les noms sont utilisés pour le suivi de la classe, la notation et les quiz. Limitez la liste aux étudiants
						concernés.
					</PrivacyNotice>
					<Field.FieldGroup>
						{#if editor === 'import'}
							<Field.Field
								data-invalid={!!$importErrors.source?.length || preview.errors.length > 0}
								data-disabled={pending || readingFile}
							>
								<Form.Field form={importForm} name="source">
									<Form.Control id="roster-source">
										{#snippet children({ props })}
											<Form.Label>Liste des étudiants</Form.Label>
											<Textarea
												{...props}
												bind:value={$importData.source}
												aria-required="true"
												required
												rows={6}
												maxlength={200000}
												class="max-h-56 min-h-36"
												disabled={pending || readingFile}
												oninput={(event) => {
													$importData.file = null;
													$importErrors.file = undefined;
													void importForm.validate('source', {
														value: event.currentTarget.value,
														update: true
													});
												}}
												placeholder="Un nom complet par ligne"
											/>
										{/snippet}
									</Form.Control>
									<Form.Description
										>Un nom par ligne, ou un CSV avec « nom complet » ou « prénom » et « nom » en en-tête. Virgule,
										point-virgule et tabulation sont acceptés.</Form.Description
									>
									<Form.FieldErrors aria-live="polite" />
								</Form.Field>
							</Field.Field>
							<Field.Field data-invalid={!!$importErrors.file?.length} data-disabled={pending || readingFile}>
								<Form.Field form={importForm} name="file">
									<Form.Control id="roster-file">
										{#snippet children({ props })}
											<Form.Label>Ou choisir un fichier CSV (optionnel)</Form.Label>
											<Input
												{...props}
												type="file"
												required={false}
												aria-required={false}
												accept=".csv,.tsv,text/csv,text/tab-separated-values"
												class="min-h-11"
												onchange={readFile}
												disabled={pending || readingFile}
											/>
										{/snippet}
									</Form.Control>
									<Form.Description
										>200 Ko maximum. Le fichier est lu sur cet appareil ; seuls les noms confirmés seront enregistrés.</Form.Description
									>
									<Form.FieldErrors aria-live="polite" />
								</Form.Field>
							</Field.Field>
						{:else}
							<Field.Field data-invalid={!!$studentErrors.name?.length} data-disabled={pending}>
								<Form.Field form={studentForm} name="name">
									<Form.Control id="student-name">
										{#snippet children({ props })}
											<Form.Label>Nom complet</Form.Label>
											<Input
												{...props}
												bind:value={$studentData.name}
												aria-required="true"
												required
												maxlength={200}
												class="min-h-11"
												disabled={pending}
												oninput={(event) => {
													if ($studentErrors.name?.length)
														void studentForm.validate('name', {
															value: event.currentTarget.value,
															update: true
														});
												}}
												autocomplete="off"
											/>
										{/snippet}
									</Form.Control>
									<Form.Description
										>Ce nom est partagé par les modules de la classe. Un homonyme peut être ajouté manuellement.</Form.Description
									>
									<Form.FieldErrors aria-live="polite" />
								</Form.Field>
							</Field.Field>
						{/if}
					</Field.FieldGroup>
					{#if editor === 'import' && $importData.source.trim()}
						{#if preview.errors.length}
							<Alert.Root variant="destructive" role="alert">
								<Alert.Title>Corrigez la liste avant l’import</Alert.Title>
								<Alert.Description
									><ul class="flex max-h-36 list-disc flex-col gap-1 overflow-y-auto pl-4">
										{#each preview.errors as item (item.line)}<li>
												Ligne {item.line} : {item.message}
											</li>{/each}
									</ul>
									<p>Aucun étudiant ne sera ajouté tant qu’une erreur reste présente.</p></Alert.Description
								>
							</Alert.Root>
						{/if}
						<div class="flex flex-col gap-3">
							<p class="text-sm font-medium" role="status">
								{preview.names.length} nom{preview.names.length > 1 ? 's' : ''} à ajouter · {preview.duplicates.length} doublon{preview
									.duplicates.length > 1
									? 's'
									: ''} ignoré{preview.duplicates.length > 1 ? 's' : ''}
							</p>
							{#if preview.names.length}
								<ul aria-label="Noms à ajouter" class="max-h-48 overflow-y-auto rounded-xl border px-4 py-2">
									{#each preview.names as item (item)}<li class="py-1 text-sm break-words">
											{item}
										</li>{/each}
								</ul>
							{:else if !preview.errors.length}
								<p class="text-sm text-muted-foreground">Aucun nouveau nom à ajouter.</p>
							{/if}
							{#if preview.duplicates.length}
								<div class="flex flex-col gap-2">
									<p class="text-sm text-muted-foreground">
										Ces noms sont déjà dans la classe ou répétés dans la liste. L’import les ignore après normalisation
										des espaces et de la casse. Ajoutez les homonymes manuellement.
									</p>
									<ul
										aria-label="Doublons ignorés"
										class="max-h-28 list-disc overflow-y-auto pl-4 text-sm text-muted-foreground"
									>
										{#each skippedNames as item (item)}<li class="break-words">{item}</li>{/each}
									</ul>
								</div>
							{/if}
						</div>
					{/if}
					<ClassMutationFeedback {error} {pending} onReload={reloadEditor} />
					<p role="status" class="sr-only">
						{readingFile ? 'Lecture du fichier…' : pending ? 'Enregistrement en cours…' : ''}
					</p>
					<p class="text-xs text-muted-foreground">Fermer conserve votre saisie pendant cette visite de la page.</p>
					<Dialog.Footer>
						<Button variant="outline" class="min-h-11" disabled={pending || readingFile} onclick={closeEditor}
							>Fermer</Button
						>
						<Button type="submit" class="min-h-11" disabled={pending || readingFile || !canSaveName}>
							{pending
								? 'Enregistrement…'
								: editor === 'import'
									? preview.names.length
										? `Ajouter ${preview.names.length} étudiant${preview.names.length > 1 ? 's' : ''}`
										: 'Importer les étudiants'
									: editor === 'edit'
										? 'Enregistrer le nom'
										: 'Ajouter l’étudiant'}
						</Button>
					</Dialog.Footer>
				</form>
			{/key}
		</Dialog.Content>
	{/if}
</Dialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content
		class="max-h-[calc(100dvh-2rem)] overflow-y-auto"
		onCloseAutoFocus={async (event) => {
			event.preventDefault();
			await tick();
			if (deleteOpener?.isConnected) deleteOpener.focus();
			else document.getElementById('roster-title')?.focus();
		}}
		onEscapeKeydown={(event) => {
			if (deleting) event.preventDefault();
		}}
	>
		<AlertDialog.Header>
			<AlertDialog.Title class="wrap-anywhere">Supprimer {deleteStudent?.name} ?</AlertDialog.Title>
			<AlertDialog.Description>
				Cet étudiant, ses corrections et ses commentaires associés seront supprimés définitivement de cette classe. Les
				modules de la classe restent disponibles.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<ClassMutationFeedback error={deleteError} pending={deleting} onReload={reloadDelete} />
		<p class="sr-only" role="status">{deleting ? 'Suppression en cours…' : ''}</p>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class="min-h-11" disabled={deleting}>Annuler</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" class="min-h-11" disabled={deleting} onclick={remove}
				>{deleting ? 'Suppression…' : 'Supprimer définitivement'}</AlertDialog.Action
			>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<style>
	.roster-content :global([data-slot='table-head']) {
		background: var(--muted);
	}
	.roster-content :global([data-slot='avatar-fallback']) {
		border-radius: var(--radius);
	}
	@media (max-width: 39.99rem) {
		.roster-actions :global([data-slot='button']) {
			flex: 1;
		}
		.roster-content :global([data-slot='table-head']:first-child),
		.roster-content :global([data-slot='table-cell']:first-child) {
			display: none;
		}
	}
</style>
