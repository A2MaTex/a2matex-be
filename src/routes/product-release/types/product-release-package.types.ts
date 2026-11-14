export interface ProductReleaseManifest {
  productId: string;
  releaseId: string;
  version: string;
  minimumLauncherVersion: string;
  minimumRuntimeVersion: string;
  entryNodeId: string;

  workflow: {
    path: 'workflow.enc';
    sha256: string;
    encryption: {
      algorithm: 'AES-256-GCM';
      nonce: string;
      authenticationTagBytes: 16;
    };
  };

  inputSchema: {
    path: 'input-schema.json';
    sha256: string;
  };

  requiredCapabilities: string[];
}

export interface BuildPackageInput {
  productId: string;
  releaseId: string;
  version: string;

  minimumLauncherVersion: string;
  minimumRuntimeVersion: string;

  // Already validated Runtime IR from WorkflowRevision
  runtimeIr: {
    entryNodeId: string;
    requiredCapabilities: string[];
    [key: string]: unknown;
  };

  // Already validated input schema
  inputSchema: unknown;
}

export interface BuildPackageResult {
  packageBuffer: Buffer;
  packageHash: string;
  packageSize: number;
  contentNonce: Buffer;
  wrappedKey: Buffer;
  contentKeyNonce: Buffer;
}
