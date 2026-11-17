import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config.js';

export default defineConfig({
	...unitConfig,
	test: {
		...unitConfig.test,
		include: [
			'src/lib/domain/**/*.test.ts',
			'src/lib/grading/**/*.test.ts',
			'src/lib/teaching/**/*.test.ts',
			'src/lib/quizzes/**/*.test.ts'
		]
	}
});
