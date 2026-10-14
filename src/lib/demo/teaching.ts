export type TeachingModule = {
	id: string;
	title: string;
	className: 'B2' | 'B3';
	students: number;
	materialState: 'À publier' | 'Publiés' | 'En préparation';
	intervention: string;
	summary: string;
};

export const demoModules: TeachingModule[] = [
	{
		id: 'application-web',
		title: 'Application web',
		className: 'B2',
		students: 12,
		materialState: 'À publier',
		intervention: 'Mardi 13 octobre · 9 h – 12 h',
		summary: 'Consigne du projet et barème prêts à partager.'
	},
	{
		id: 'frontend',
		title: 'Développement frontend',
		className: 'B3',
		students: 10,
		materialState: 'Publiés',
		intervention: 'Jeudi 15 octobre · 9 h – 12 h',
		summary: 'Supports du cours et ressources disponibles.'
	},
	{
		id: 'projet',
		title: 'Projet de développement',
		className: 'B2',
		students: 12,
		materialState: 'Publiés',
		intervention: 'Mardi 20 octobre · 9 h – 12 h',
		summary: 'Préparer les ressources de la prochaine intervention.'
	},
	{
		id: 'qualite',
		title: 'Qualité logicielle',
		className: 'B3',
		students: 10,
		materialState: 'En préparation',
		intervention: 'Jeudi 22 octobre · 9 h – 12 h',
		summary: 'Cadrage validé, supports à préparer.'
	}
];

export function createDemoStudents() {
	return [
		{ id: 'camille', name: 'Camille Martin', grade: '14', absent: false },
		{ id: 'alex', name: 'Alex Dubois', grade: '12', absent: false },
		{ id: 'noa', name: 'Noa Petit', grade: '', absent: true },
		{ id: 'morgan', name: 'Morgan Laurent', grade: '', absent: false }
	];
}
