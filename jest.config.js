/** @type {import('ts-jest').JestConfigWithTsJest} */
const path = require('node:path');

module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	// repo root, regardless of the cwd the gate invokes jest from
	rootDir: __dirname,
	testMatch: ['**/__tests__/**/*.test.ts'],
	moduleFileExtensions: ['ts', 'js', 'json'],
	transform: {
		'^.+\\.ts$': ['ts-jest', { tsconfig: path.join(__dirname, 'tsconfig.json') }],
	},
};