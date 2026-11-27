import { createZodDto } from 'nestjs-zod';
import { LauncherProductListOutput } from './launcher.model.ts';

export class LauncherProductListOutputDTO extends createZodDto(LauncherProductListOutput) {}
