<script lang="ts">
	import { tick, untrack } from 'svelte';
	import type { SuperForm } from 'sveltekit-superforms';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import XIcon from '@lucide/svelte/icons/x';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import { Button, buttonVariants } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Form from '#lib/components/ui/form/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import type { RubricAssessment } from '#lib/domain/grading.js';
	import {
		moveRubricItem,
		rubricMaximumLabel as maximum,
		syncRubricSections,
		type RubricEditorInput
	} from '#lib/grading/rubric-form.js';
	import { cn } from '#lib/utils.js';
	import RubricField from './RubricField.svelte';

	let {
		form,
		assessment,
		assessmentIndex,
		assessmentCount,
		isSavedAssessment,
		pending,
		expandedDescriptions = $bindable([]),
		onRemove,
		onReorder,
		onRevalidate,
		onStatus
	}: {
		form: SuperForm<RubricEditorInput, string>;
		assessment: RubricAssessment;
		assessmentIndex: number;
		assessmentCount: number;
		isSavedAssessment: boolean;
		pending: boolean;
		expandedDescriptions: string[];
		onRemove: () => void;
		onReorder: (direction: number) => void;
		onRevalidate: () => Promise<void>;
		onStatus: (message: string) => void;
	} = $props();
	const { form: formData } = untrack(() => form);
	const removalLabel = $derived(isSavedAssessment ? 'Retirer la section' : 'Annuler le brouillon');
	const kindOptions = [
		{ value: 'quiz', label: 'Quiz' },
		{ value: 'project', label: 'Projet' },
		{ value: 'oral', label: 'Soutenance' },
		{ value: 'other', label: 'Autre section' }
	];
	const purposeOptions = [
		{ value: 'graded', label: 'Notée · dans les résultats' },
		{ value: 'formative', label: 'Formative · hors résultats' }
	];
	const updateAssessment = (update: (value: RubricAssessment) => RubricAssessment) => {
		formData.update((input) =>
			syncRubricSections({
				...input,
				assessments: input.assessments.map((item) => (item.id === assessment.id ? update(item) : item))
			})
		);
	};
	const addLine = async () => {
		const lineId = crypto.randomUUID();
		updateAssessment((value) => ({
			...value,
			lines: [...value.lines, { id: lineId, groupId: value.groups[0].id, label: '', description: '', maxPoints: 1 }]
		}));
		await tick();
		document.getElementById(`line-${lineId}-label`)?.focus();
	};
	const removeLine = (lineId: string) => {
		updateAssessment((value) => ({
			...value,
			lines: value.lines.filter((line) => line.id !== lineId)
		}));
		void onRevalidate();
	};
	const reorderLine = (index: number, direction: number) => {
		updateAssessment((value) => ({
			...value,
			lines: moveRubricItem(value.lines, index, direction)
		}));
		void onRevalidate();
	};
	const editDescription = async (lineId: string) => {
		if (!expandedDescriptions.includes(lineId)) expandedDescriptions = [...expandedDescriptions, lineId];
		await tick();
		document.getElementById(`line-${lineId}-description`)?.focus();
	};
	const addGroup = async () => {
		const groupId = crypto.randomUUID();
		updateAssessment((value) => ({
			...value,
			groups: [...value.groups, { id: groupId, title: '' }]
		}));
		await tick();
		document.getElementById(`group-${groupId}-title`)?.focus();
	};
	const removeGroup = (groupId: string) => {
		updateAssessment((value) => {
			const groups = value.groups.filter((group) => group.id !== groupId);
			if (!groups.length) return value;
			return {
				...value,
				groups,
				lines: value.lines.map((line) => (line.groupId === groupId ? { ...line, groupId: groups[0].id } : line))
			};
		});
		onStatus(
			'Groupe retiré du brouillon ; ses critères ont rejoint le premier groupe. Enregistrez le barème pour confirmer.'
		);
		void onRevalidate();
	};
	const reorderGroup = (index: number, direction: number) => {
		updateAssessment((value) => ({
			...value,
			groups: moveRubricItem(value.groups, index, direction)
		}));
		void onRevalidate();
	};
</script>

<Form.Fieldset {form} name={`assessments[${assessmentIndex}]`} class="block min-w-0">
	<Form.Legend class="sr-only">{assessment.title || 'Nouvelle section'}</Form.Legend>
	<div class="assessment-fields flex min-w-0 flex-col gap-5">
		<Field.FieldGroup class="assessment-settings grid min-w-0">
			<div class="assessment-title flex min-w-0 flex-wrap items-end gap-3">
				<div class="min-w-0 flex-1 basis-48">
					<RubricField
						{form}
						name={`assessments[${assessmentIndex}].title`}
						id={`assessment-${assessment.id}-title`}
						label="Nom de la section"
						maxlength={200}
					/>
				</div>
				<Button
					type="button"
					variant={isSavedAssessment ? 'destructive-outline' : 'outline'}
					size="icon"
					aria-label={removalLabel}
					title={removalLabel}
					class="size-11 shrink-0"
					onclick={onRemove}
					>{#if isSavedAssessment}
						<TrashIcon />
					{:else}
						<XIcon />
					{/if}</Button
				>
			</div>
			<div class="assessment-purpose min-w-0">
				<RubricField
					{form}
					name={`assessments[${assessmentIndex}].purpose`}
					id={`assessment-${assessment.id}-purpose`}
					label="Participation aux résultats"
					options={purposeOptions}
					onvaluechange={onRevalidate}
				/>
			</div>
			<RubricField
				{form}
				name={`assessments[${assessmentIndex}].kind`}
				id={`assessment-${assessment.id}-kind`}
				label="Type de section"
				options={kindOptions}
				onvaluechange={onRevalidate}
			/>
			<div class="assessment-total flex min-h-11 items-center gap-1 self-end">
				<output
					class="font-semibold tabular-nums"
					aria-label={assessment.kind === 'quiz'
						? `Total des questions des quiz de ${assessment.title || 'la section'}`
						: `Total des maxima des lignes de ${assessment.title || 'la section'}`}>{maximum(assessment)}</output
				>{@render actionsMenu(
					assessment.title || 'la section',
					assessmentIndex,
					assessmentCount,
					() => onReorder(-1),
					() => onReorder(1),
					onRemove
				)}
			</div>
		</Field.FieldGroup>
		{#if assessment.kind === 'quiz'}
			<p class="max-w-prose text-sm text-muted-foreground">
				Une ligne par quiz · 1 question = 1 point · chaque quiz a le même poids après conversion sur 20.
			</p>
		{/if}
		<div class="definition-wrap min-w-0">
			<Table.Root
				class="definition-table table-fixed"
				aria-label={`${assessment.kind === 'quiz' ? 'Quiz' : 'Critères'} de ${assessment.title || 'la section'}`}
			>
				<Table.Header
					><Table.Row
						><Table.Head class="w-[44%]">Libellé</Table.Head><Table.Head>Groupe</Table.Head><Table.Head class="w-24"
							>Maximum</Table.Head
						><Table.Head class="w-14"><span class="sr-only">Actions</span></Table.Head></Table.Row
					></Table.Header
				>
				<Table.Body>
					{#each assessment.lines as line, lineIndex (line.id)}
						<Table.Row class="criterion-row">
							<Table.Cell class="criterion-label"
								><RubricField
									{form}
									name={`assessments[${assessmentIndex}].lines[${lineIndex}].label`}
									id={`line-${line.id}-label`}
									label={`${assessment.kind === 'quiz' ? 'Nom du quiz' : 'Libellé du critère'} ${lineIndex + 1}`}
									compact
									multiline
									maxlength={200}
								/></Table.Cell
							>
							<Table.Cell
								><RubricField
									{form}
									name={`assessments[${assessmentIndex}].lines[${lineIndex}].groupId`}
									id={`line-${line.id}-group`}
									label={`${assessment.kind === 'quiz' ? 'Groupe du quiz' : 'Groupe du critère'} ${lineIndex + 1}`}
									compact
									options={assessment.groups.map((group) => ({
										value: group.id,
										label: group.title || 'Groupe sans nom'
									}))}
								/></Table.Cell
							>
							<Table.Cell
								><RubricField
									{form}
									name={`assessments[${assessmentIndex}].lines[${lineIndex}].maxPoints`}
									id={`line-${line.id}-max`}
									label={assessment.kind === 'quiz'
										? `Nombre de questions du quiz ${lineIndex + 1}`
										: `Maximum du critère ${lineIndex + 1} (pts)`}
									compact
									type="number"
									min={1}
									max={1000000}
									step={1}
									onvaluechange={onRevalidate}
								/></Table.Cell
							>
							<Table.Cell class="criterion-actions"
								>{@render actionsMenu(
									line.label || `${assessment.kind === 'quiz' ? 'le quiz' : 'le critère'} ${lineIndex + 1}`,
									lineIndex,
									assessment.lines.length,
									() => reorderLine(lineIndex, -1),
									() => reorderLine(lineIndex, 1),
									() => removeLine(line.id),
									() => editDescription(line.id),
									assessment.lines.length <= 1
								)}</Table.Cell
							>
						</Table.Row>
						{#if expandedDescriptions.includes(line.id)}<Table.Row class="description-row"
								><Table.Cell colspan={4}
									><RubricField
										{form}
										name={`assessments[${assessmentIndex}].lines[${lineIndex}].description`}
										required={false}
										id={`line-${line.id}-description`}
										label={`Description · ${line.label || `${assessment.kind === 'quiz' ? 'Quiz' : 'Critère'} ${lineIndex + 1}`}`}
										multiline
										maxlength={2000}
									/></Table.Cell
								></Table.Row
							>{/if}
					{/each}
				</Table.Body>
			</Table.Root>
		</div>
		<div class="flex flex-wrap items-center justify-between gap-3">
			<Button
				type="button"
				variant="ghost"
				class="min-h-11"
				disabled={assessment.lines.length >= 1000}
				onclick={addLine}
				><PlusIcon data-icon="inline-start" />{assessment.kind === 'quiz'
					? 'Ajouter un quiz'
					: 'Ajouter une ligne'}</Button
			>
			{#if assessment.kind !== 'quiz'}
				<p class="text-sm text-muted-foreground">Points entiers · maxima libres</p>
			{/if}
		</div>
		<Form.Fieldset
			{form}
			name={`assessments[${assessmentIndex}].groups`}
			aria-describedby={`assessment-${assessment.id}-groups-help`}
			class="flex min-w-0 flex-col gap-3"
		>
			<Form.Legend class="border-b pb-3 text-base">Groupes de lignes et maxima</Form.Legend>
			{#each assessment.groups as group, groupIndex (group.id)}<div
					class={cn('flex min-w-0 items-end gap-2', groupIndex === 0 && 'mt-4')}
				>
					<div class="min-w-0 flex-1">
						<RubricField
							{form}
							name={`assessments[${assessmentIndex}].groups[${groupIndex}].title`}
							id={`group-${group.id}-title`}
							label={`Nom du groupe ${groupIndex + 1}`}
							maxlength={200}
						/>
					</div>
					<output
						class="flex min-h-11 shrink-0 items-center text-sm font-medium tabular-nums"
						aria-label={`Maximum du groupe ${group.title || groupIndex + 1}`}>{maximum(assessment, group.id)}</output
					>{@render actionsMenu(
						group.title || `le groupe ${groupIndex + 1}`,
						groupIndex,
						assessment.groups.length,
						() => reorderGroup(groupIndex, -1),
						() => reorderGroup(groupIndex, 1),
						() => removeGroup(group.id),
						undefined,
						assessment.groups.length <= 1
					)}
				</div>{/each}
			<Form.Description id={`assessment-${assessment.id}-groups-help`}
				>Les groupes organisent les lignes du barème. Leurs maxima sont calculés à partir des lignes. En retirant un
				groupe, ses critères rejoignent le premier groupe.</Form.Description
			>
			<Button
				type="button"
				variant="ghost"
				class="min-h-11 self-start"
				disabled={assessment.groups.length >= 100}
				onclick={addGroup}><PlusIcon data-icon="inline-start" />Ajouter un groupe</Button
			><Form.FieldErrors />
		</Form.Fieldset>
		<Form.FieldErrors />
	</div>
</Form.Fieldset>

{#snippet actionsMenu(
	label: string,
	index: number,
	count: number,
	up: () => void,
	down: () => void,
	remove: () => void,
	description?: () => void,
	preventRemove = false
)}
	<DropdownMenu.Root
		><DropdownMenu.Trigger
			class={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'min-h-11 min-w-11 shrink-0')}
			disabled={pending}
			aria-label={`Actions pour ${label}`}><EllipsisIcon aria-hidden="true" /></DropdownMenu.Trigger
		><DropdownMenu.Content align="end"
			><DropdownMenu.Group
				>{#if description}<DropdownMenu.Item class="min-h-11" disabled={pending} onSelect={description}
						><PencilIcon aria-hidden="true" />Modifier la description</DropdownMenu.Item
					>{/if}<DropdownMenu.Item class="min-h-11" disabled={pending || index === 0} onSelect={up}
					><ArrowUpIcon aria-hidden="true" />Monter</DropdownMenu.Item
				><DropdownMenu.Item class="min-h-11" disabled={pending || index === count - 1} onSelect={down}
					><ArrowDownIcon aria-hidden="true" />Descendre</DropdownMenu.Item
				><DropdownMenu.Item class="min-h-11" variant="destructive" disabled={pending || preventRemove} onSelect={remove}
					><TrashIcon aria-hidden="true" />Retirer</DropdownMenu.Item
				></DropdownMenu.Group
			></DropdownMenu.Content
		></DropdownMenu.Root
	>
{/snippet}

<style>
	.definition-wrap {
		container: criteria / inline-size;
	}
	.assessment-fields :global(.assessment-settings) {
		grid-template-columns: minmax(0, 1fr);
		gap: 1.5rem;
	}
	.assessment-title,
	.assessment-purpose {
		grid-column: auto;
	}
	.assessment-title :global(input) {
		min-height: 3rem;
		font-size: 1.25rem;
		font-weight: 600;
	}
	.assessment-total {
		justify-content: space-between;
		border-top: 1px solid var(--border);
		padding-top: 0.75rem;
	}
	.definition-wrap :global([data-slot='table-container']) {
		min-width: 0;
	}
	.definition-wrap :global([data-slot='table-cell']) {
		padding: 0.75rem;
		vertical-align: middle;
		white-space: normal;
	}
	.definition-wrap :global([data-slot='table-head']) {
		white-space: normal;
	}
	@container rubric (min-width: 40rem) {
		.assessment-fields :global(.assessment-settings) {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.assessment-title,
		.assessment-total {
			grid-column: 1 / -1;
		}
	}
	@container criteria (max-width: 35rem) {
		.definition-wrap :global([data-slot='table-container']) {
			overflow: visible;
		}
		.definition-wrap :global(.definition-table),
		.definition-wrap :global(tbody) {
			display: block;
		}
		.definition-wrap :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
		}
		.definition-wrap :global(.criterion-row) {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 56px;
			align-items: end;
			gap: 0.75rem;
			padding: 1.25rem 0;
		}
		.definition-wrap :global([data-slot='table-cell']) {
			padding: 0;
		}
		.definition-wrap :global(.criterion-label) {
			grid-column: 1 / -1;
		}
		.definition-wrap :global(.criterion-actions) {
			align-self: end;
		}
		.definition-wrap :global(.description-row),
		.definition-wrap :global(.description-row td) {
			display: block;
		}
	}
</style>
