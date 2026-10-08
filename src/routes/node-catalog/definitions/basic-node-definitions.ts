import { NodeDefinitionCatalogContract } from '../node-definition.model.ts';
import { ANDROID_NODE_DEFINITIONS } from './android-node-definitions.ts';
import { FLOW_NODE_DEFINITIONS } from './flow-node-definitions.ts';

export const BASIC_NODE_DEFINITIONS = NodeDefinitionCatalogContract.parse([
  ...FLOW_NODE_DEFINITIONS,
  ...ANDROID_NODE_DEFINITIONS,
]);
