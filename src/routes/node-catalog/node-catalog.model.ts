import { z } from 'zod';
import {
  NODE_CAPABILITY_CODE_MAX_LENGTH,
  NODE_CAPABILITY_CODE_PATTERN,
  NODE_NAME_MAX_LENGTH,
  STRICT_SEMANTIC_VERSION_PATTERN,
} from './node-catalog.constant.ts';
import { NodeDefinitionContract } from './node-definition.model.ts';

export const GetNodeCatalogInput = z
  .object({
    runtimeVersion: z.string().regex(STRICT_SEMANTIC_VERSION_PATTERN),
  })
  .strict();

const CapabilityOutput = z
  .object({
    code: z
      .string()
      .min(1)
      .max(NODE_CAPABILITY_CODE_MAX_LENGTH)
      .regex(NODE_CAPABILITY_CODE_PATTERN),
    name: z.string().min(1).max(NODE_NAME_MAX_LENGTH),
    description: z.string().min(1),
    isSensitive: z.boolean(),
  })
  .strict();

const NodeCatalogItemOutput = z
  .object({
    type: NodeDefinitionContract.shape.type,
    name: NodeDefinitionContract.shape.name,
    description: NodeDefinitionContract.shape.description,
    category: NodeDefinitionContract.shape.category,
    runtimeHandler: NodeDefinitionContract.shape.runtimeHandler,
    minimumRuntimeVersion: NodeDefinitionContract.shape.minimumRuntimeVersion,
    defaultTimeoutMs: NodeDefinitionContract.shape.defaultTimeoutMs,
    configSchema: NodeDefinitionContract.shape.configSchema,
    inputSchema: NodeDefinitionContract.shape.inputSchema,
    outputSchema: NodeDefinitionContract.shape.outputSchema,
    outputPorts: NodeDefinitionContract.shape.outputPorts,
    editorHints: NodeDefinitionContract.shape.editorHints,
    supportedErrorPolicies: NodeDefinitionContract.shape.supportedErrorPolicies,
    capabilities: z.array(CapabilityOutput),
  })
  .strict();

export const GetNodeCatalogOutput = z
  .object({
    catalogHash: z.string().regex(/^[0-9a-f]{64}$/),
    nodes: z.array(NodeCatalogItemOutput),
  })
  .strict();

export type GetNodeCatalogInputType = z.infer<typeof GetNodeCatalogInput>;
export type GetNodeCatalogOutputType = z.infer<typeof GetNodeCatalogOutput>;
