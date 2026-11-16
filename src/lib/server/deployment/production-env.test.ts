import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const callerSource = `
import {
	checkCurrentMain,
	productionConfig,
	productionSecrets,
	validateRelease
} from './scripts/production.js';

const environment = process.env;
const partial = { GITHUB_REPOSITORY: 'Nekxio/Campus' };

validateRelease({}, 'a'.repeat(40));
validateRelease(partial, 'a'.repeat(40));
validateRelease(process.env, 'a'.repeat(40));
checkCurrentMain({});
checkCurrentMain(partial);
checkCurrentMain(process.env);
productionConfig({}, {}, '/tmp');
productionConfig({}, partial, '/tmp');
productionConfig({}, process.env, '/tmp');
productionSecrets({});
productionSecrets(partial);
productionSecrets(process.env);
`;

const augmentationSource = `
export {};
declare global {
	namespace NodeJS {
		interface ProcessEnv {
			ORIGIN: string;
			BETTER_AUTH_SECRET: string;
			DATABASE_URL: string;
		}
	}
}
`;

describe('production environment input types', () => {
	it.each([false, true])(
		'compiles empty, partial and process.env inputs with required ambient bindings: %s',
		(augmented) => {
			const callerPath = resolve('production-env-caller.ts');
			const sources = new Map([[callerPath, callerSource]]);
			if (augmented) {
				sources.set(resolve('production-env-augmentation.d.ts'), augmentationSource);
			}
			const options: ts.CompilerOptions = {
				strict: true,
				noEmit: true,
				target: ts.ScriptTarget.ESNext,
				module: ts.ModuleKind.NodeNext,
				moduleResolution: ts.ModuleResolutionKind.NodeNext,
				types: ['node']
			};
			const host = ts.createCompilerHost(options);
			const readFile = host.readFile.bind(host);
			const fileExists = host.fileExists.bind(host);
			const getSourceFile = host.getSourceFile.bind(host);
			host.readFile = (fileName) => sources.get(resolve(fileName)) ?? readFile(fileName);
			host.fileExists = (fileName) => sources.has(resolve(fileName)) || fileExists(fileName);
			host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
				const source = sources.get(resolve(fileName));
				return source === undefined
					? getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
					: ts.createSourceFile(fileName, source, languageVersion, true);
			};

			const program = ts.createProgram([...sources.keys()], options, host);
			expect(program.getSourceFile(resolve('scripts/production.ts'))).toBeDefined();
			const caller = program.getSourceFile(callerPath);
			if (!caller) throw new Error('In-memory production caller was not loaded.');
			const environment = caller.statements
				.filter(ts.isVariableStatement)
				.flatMap((statement) => statement.declarationList.declarations)
				.find((declaration) => declaration.name.getText(caller) === 'environment');
			if (!environment) throw new Error('Process environment declaration was not found.');
			const checker = program.getTypeChecker();
			const environmentType = checker.getTypeAtLocation(environment.name);
			for (const name of ['ORIGIN', 'BETTER_AUTH_SECRET', 'DATABASE_URL']) {
				const property = environmentType.getProperty(name);
				if (augmented) {
					expect(property, name).toBeDefined();
					if (!property) throw new Error('Required ambient binding was not applied.');
					expect(property.flags & ts.SymbolFlags.Optional, name).toBe(0);
					expect(checker.typeToString(checker.getTypeOfSymbolAtLocation(property, environment)), name).toBe('string');
				} else {
					expect(property, name).toBeUndefined();
				}
			}
			expect(
				ts
					.getPreEmitDiagnostics(program)
					.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
			).toEqual([]);
		},
		20000
	);
});
