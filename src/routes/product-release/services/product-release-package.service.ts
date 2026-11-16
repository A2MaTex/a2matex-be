import { Inject, Injectable } from '@nestjs/common';
import * as yazl from 'yazl';
import {
  BuildPackageInput,
  BuildPackageResult,
  ProductReleaseManifest,
} from '../types/product-release-package.types.ts';
import { KeyService } from '../../../shared/services/key.service.ts';
import { sha256, toCanonicalBytes } from '../utils/package-crypto.util.ts';

@Injectable()
export class ProductReleasePackageService {
  // gán một ngày cố định -> đảm bảo cùng input → cùng output byte-for-byte.
  private readonly ZIP_DATE = new Date('1980-01-01T00:00:00.000Z');
  // Unix file permission mode theo chuẩn POSIX
  private readonly ZIP_MODE = 0o100644;

  constructor(@Inject(KeyService) private readonly keyService: KeyService) {}

  async buildPackage(input: BuildPackageInput): Promise<BuildPackageResult> {
    this.validateInput(input);

    // 1. Canonicalize input schema
    const inputSchemaBytes = toCanonicalBytes(input.inputSchema);
    const inputSchemaHash = sha256(inputSchemaBytes);

    // 2. Canonicalize Runtime IR
    const runtimeIrBytes = toCanonicalBytes(input.runtimeIr);

    // 3. Encrypt Runtime IR

    // need to store contentWrappedKey = wrapped key, contentKeyNonce = keyNonce,
    const { wrappedKey, keyNonce } = this.keyService.generate(input.releaseId);

    //need to store content nonce = nonce
    const { ciphertext, nonce } = await this.keyService.withKey(
      input.releaseId,
      wrappedKey,
      keyNonce,
      async (contentKey) => this.keyService.encrypt(runtimeIrBytes, contentKey),
    );

    const workflowBytes = ciphertext;
    const workflowHash = sha256(workflowBytes);

    // 4. Construct manifest
    const manifest: ProductReleaseManifest = {
      productId: input.productId,
      releaseId: input.releaseId,
      version: input.version,
      minimumLauncherVersion: input.minimumLauncherVersion,
      minimumRuntimeVersion: input.minimumRuntimeVersion,
      entryNodeId: input.runtimeIr.entryNodeId,

      workflow: {
        path: 'workflow.enc',
        sha256: workflowHash,
        encryption: {
          algorithm: 'AES-256-GCM',
          nonce: nonce.toString('base64'),
          authenticationTagBytes: 16,
        },
      },

      inputSchema: {
        path: 'input-schema.json',
        sha256: inputSchemaHash,
      },

      requiredCapabilities: input.runtimeIr.requiredCapabilities,
    };

    const manifestBytes = toCanonicalBytes(manifest);

    // 5. Build final ZIP
    const packageBuffer = await this.createZip(manifestBytes, workflowBytes, inputSchemaBytes);

    // 6. Hash exact final ZIP bytes
    const packageHash = sha256(packageBuffer);

    return {
      packageBuffer,
      packageHash,
      packageSize: packageBuffer.length,
      contentNonce: nonce,
      wrappedKey: wrappedKey,
      contentKeyNonce: keyNonce,
    };
  }

  private createZip(
    manifestBytes: Buffer,
    workflowBytes: Buffer,
    inputSchemaBytes: Buffer,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const zip = new yazl.ZipFile();
      const chunks: Buffer[] = [];

      const commonOptions = {
        mtime: this.ZIP_DATE,
        mode: this.ZIP_MODE,
      };

      // Order is part of the package contract
      zip.addBuffer(manifestBytes, 'manifest.json', {
        ...commonOptions,
        compress: true,
      });

      zip.addBuffer(workflowBytes, 'workflow.enc', {
        ...commonOptions,
        compress: false,
      });

      zip.addBuffer(inputSchemaBytes, 'input-schema.json', {
        ...commonOptions,
        compress: true,
      });

      zip.outputStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      zip.outputStream.once('end', () => {
        resolve(Buffer.concat(chunks));
      });

      zip.outputStream.once('error', reject);

      try {
        zip.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  private validateInput(input: BuildPackageInput): void {
    if (!input.productId || !input.releaseId || !input.version) {
      throw new Error('Missing release identity');
    }

    if (!input.minimumLauncherVersion || !input.minimumRuntimeVersion) {
      throw new Error('Missing minimum version requirements');
    }

    if (
      !input.runtimeIr ||
      typeof input.runtimeIr.entryNodeId !== 'string' ||
      !input.runtimeIr.entryNodeId ||
      !Array.isArray(input.runtimeIr.requiredCapabilities) ||
      !input.runtimeIr.requiredCapabilities.every((capability) => typeof capability === 'string')
    ) {
      throw new Error('Invalid Runtime IR metadata');
    }
  }
}
