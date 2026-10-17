<script module lang="ts">
	import type { RubricData, StudentGrading } from '#lib/domain/grading.js';
	export type DetailedCorrectionData = {
		rubric: RubricData;
		contextId: string;
		students: StudentGrading[];
		studentId: string;
	};
</script>

<script lang="ts">
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import DetailedCorrectionDraft from './DetailedCorrectionDraft.svelte';
	let { data }: { data: DetailedCorrectionData } = $props();
	const student = $derived(data.students.find((item) => item.id === data.studentId));
	let reloadVersion = $state(0);
	async function reload() {
		await refreshAll();
		reloadVersion += 1;
	}
</script>

{#if student && data.rubric.assessments.length > 0}
	{#key `${data.contextId}:${data.studentId}:${reloadVersion}`}
		<DetailedCorrectionDraft {data} {student} onreload={reload} />
	{/key}
{:else}
	<Empty.Root>
		<Empty.Header>
			<Empty.Title>{student ? 'Aucune évaluation à corriger' : 'Étudiant indisponible'}</Empty.Title
			>
			<Empty.Description
				>{student
					? 'Ajoutez une évaluation au barème du module pour commencer.'
					: 'Cet étudiant ne figure plus dans cette classe.'}</Empty.Description
			>
		</Empty.Header>
		<Empty.Content
			><Button
				href={resolve('/enseignant/notation') +
					`?module=${data.rubric.module.id}&contexte=${data.contextId}&etudiant=${data.studentId}`}
				variant="outline"
				class="min-h-11">Retour à la grille</Button
			></Empty.Content
		>
	</Empty.Root>
{/if}
