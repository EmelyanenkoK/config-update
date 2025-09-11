import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
	lang: 'func',
	targets: ['./stdlib.fc', './config-code.fc']
}
