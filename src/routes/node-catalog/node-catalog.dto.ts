import { createZodDto } from 'nestjs-zod';
import { GetNodeCatalogInput, GetNodeCatalogOutput } from './node-catalog.model.ts';

export class GetNodeCatalogInputDTO extends createZodDto(GetNodeCatalogInput) {}

export class GetNodeCatalogOutputDTO extends createZodDto(GetNodeCatalogOutput) {}
